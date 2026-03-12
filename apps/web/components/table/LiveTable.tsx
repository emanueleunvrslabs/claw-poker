'use client'
import { useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3010'
const SPECTATE_WS = `${API_URL}/spectate`

interface DemoPlayer {
  agent_id: string; agent_name: string; emoji: string
  chips: number; bet_this_round: number
  hole_cards: { rank: number; suit: string }[]
  is_folded: boolean; is_all_in: boolean; is_dealer: boolean
  is_small_blind: boolean; is_big_blind: boolean
  is_current_turn: boolean; time_remaining: number
}
interface DemoState {
  tournament_id: string; hand_number: number; phase: string
  community_cards: { rank: number; suit: string }[]
  pot: number; players: DemoPlayer[]
  actions: { agent_name: string; action: string; amount?: number; timestamp: string }[]
  blind_level: number; small_blind: number; big_blind: number
  ante: number; next_level_in: number; players_remaining: number; total_players: number
  status: 'playing' | 'showdown' | 'between_hands'
  last_winners?: { agent_name: string; amount: number }[]
}

// ─── Card ─────────────────────────────────────────────────────
const RANKS: Record<number,string> = {2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A'}
const SUITS: Record<string,string> = {h:'♥',d:'♦',c:'♣',s:'♠'}
const SUIT_BG: Record<string,string> = {
  s:'linear-gradient(160deg,#505870 0%,#3a4058 100%)',
  h:'linear-gradient(160deg,#c0392b 0%,#922b21 100%)',
  d:'linear-gradient(160deg,#2471a3 0%,#1a5276 100%)',
  c:'linear-gradient(160deg,#1e8449 0%,#145a32 100%)',
}

function Card({card,back,w=44,h=63}:{card?:{rank:number;suit:string};back?:boolean;w?:number;h?:number}) {
  if (back||!card) return (
    <div style={{width:w,height:h,borderRadius:6,flexShrink:0,background:'linear-gradient(160deg,#1e4080 0%,#0f2550 50%,#071830 100%)',border:'2px solid rgba(60,120,220,0.4)',boxShadow:'0 4px 16px rgba(0,0,0,0.8),inset 0 1px 0 rgba(255,255,255,0.12)',display:'flex',alignItems:'center',justifyContent:'center',position:'relative',overflow:'hidden'}}>
      <div style={{position:'absolute',inset:3,borderRadius:4,border:'1px solid rgba(34,211,238,0.2)',backgroundImage:'repeating-linear-gradient(45deg,rgba(34,211,238,0.05) 0px,rgba(34,211,238,0.05) 2px,transparent 2px,transparent 8px),repeating-linear-gradient(-45deg,rgba(34,211,238,0.05) 0px,rgba(34,211,238,0.05) 2px,transparent 2px,transparent 8px)'}}/>
      <span style={{fontSize:w*0.4,opacity:0.35,color:'#60a5fa',position:'relative'}}>♠</span>
    </div>
  )
  const rank = RANKS[card.rank]; const suit = SUITS[card.suit]
  return (
    <div style={{width:w,height:h,borderRadius:6,flexShrink:0,background:SUIT_BG[card.suit]??SUIT_BG.s,border:'2px solid rgba(255,255,255,0.18)',boxShadow:'0 4px 14px rgba(0,0,0,0.55),inset 0 1px 0 rgba(255,255,255,0.2)',position:'relative',overflow:'hidden',color:'#fff'}}>
      <div style={{position:'absolute',top:4,left:5,fontSize:w*0.26,lineHeight:1,opacity:0.9}}>{suit}</div>
      <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none'}}>
        <div style={{fontSize:w*0.6,fontWeight:900,fontFamily:'ui-rounded,system-ui,-apple-system,sans-serif',lineHeight:1,textShadow:'0 2px 8px rgba(0,0,0,0.4)',letterSpacing:-1}}>{rank}</div>
      </div>
    </div>
  )
}

// ─── Fixed canvas: 900 × 700 px ──────────────────────────────
// Canvas is taller (700) to give room above and below the table rail
// for player elements positioned outside the felt.
//
// SVG table:  rail x=35 y=115 w=830 h=470 rx=235   center=(450,350)
// Rail top: y=115  Rail bottom: y=585
//
// Cards and nameplate are positioned INDEPENDENTLY.
// All cards: horizontal row (side-by-side).
// Cards always rendered ABOVE nameplate on screen (smaller y).
//
// Transforms define how the element anchors to its (x,y) point:
//   bottom (0,1):   cards  → bottom at y (ty='-100%')  nameplate → top at y (ty='0%')
//   top    (3,4):   cards  → bottom at y (ty='-100%')  nameplate → top at y (ty='0%')
//   right  (2):     cards  → left at x  (tx='0%')      nameplate → right at x (tx='-100%')
//   left   (5):     cards  → right at x (tx='-100%')   nameplate → left at x (tx='0%')
//
// Side player cards (seats 2,5) extend beyond the 900px canvas width.
// Use overflow:visible on the canvas div so they remain visible.
// ─────────────────────────────────────────────────────────────
const CANVAS_W = 900
const CANVAS_H = 700

// Symmetric about x=450. Rule: x_right = 900 - x_left, same y for mirrored pairs.
// Seat pairs: (0 BL ↔ 1 BR), (4 TL ↔ 3 TR), (5 L ↔ 2 R)
// Left seats are the reference; right seats are exact mirrors.
const SEATS_6 = [
  { // 0 — bottom-left  (reference)
    cards:     {x:274, y:555, tx:'-50%', ty:'-100%'},
    nameplate: {x:275, y:558, tx:'-50%', ty:'0%'},
    bet:       {x:290, y:470},
    dealer:    {x:227, y:582},
    bubble:    {x:290, y:430},
  },
  { // 1 — bottom-right  (mirror of 0: x→900-x)
    cards:     {x:626, y:555, tx:'-50%', ty:'-100%'},
    nameplate: {x:625, y:558, tx:'-50%', ty:'0%'},
    bet:       {x:610, y:470},
    dealer:    {x:673, y:582},
    bubble:    {x:610, y:430},
  },
  { // 2 — right  (mirror of 5: x→900-x)
    cards:     {x:821, y:282, tx:'0%',    ty:'-50%'},
    nameplate: {x:931, y:346, tx:'-100%', ty:'-50%'},
    bet:       {x:751, y:347},
    dealer:    {x:813, y:346},
    bubble:    {x:751, y:312},
  },
  { // 3 — top-right  (mirror of 4: x→900-x)
    cards:     {x:625, y:21,  tx:'-50%', ty:'0%'},
    nameplate: {x:625, y:141, tx:'-50%', ty:'-100%'},
    bet:       {x:611, y:175},
    dealer:    {x:673, y:117},
    bubble:    {x:611, y:212},
  },
  { // 4 — top-left  (reference)
    cards:     {x:275, y:21,  tx:'-50%', ty:'0%'},
    nameplate: {x:275, y:141, tx:'-50%', ty:'-100%'},
    bet:       {x:289, y:175},
    dealer:    {x:227, y:117},
    bubble:    {x:289, y:212},
  },
  { // 5 — left  (reference)
    cards:     {x:79,  y:282, tx:'-100%', ty:'-50%'},
    nameplate: {x:-31, y:346, tx:'0%',    ty:'-50%'},
    bet:       {x:149, y:347},
    dealer:    {x:87,  y:346},
    bubble:    {x:149, y:312},
  },
]

const ACTION_COLOR: Record<string, string> = {
  fold:   'rgba(239,68,68,0.92)',
  check:  'rgba(100,116,139,0.92)',
  call:   'rgba(34,211,238,0.92)',
  bet:    'rgba(16,185,129,0.92)',
  raise:  'rgba(251,191,36,0.92)',
  all_in: 'rgba(251,191,36,0.92)',
}

export function LiveTable({ tournamentId }: { tournamentId?: string }) {
  const [state, setState] = useState<DemoState | null>(null)
  const [connected, setConnected] = useState(false)
  const [scale, setScale] = useState(1)
  const [bubbles, setBubbles] = useState<Record<string,{text:string;color:string;key:number}>>({})
  const containerRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<Socket | null>(null)
  const lastActionKeyRef = useRef<string>('')

  useEffect(() => {
    const socket = io(SPECTATE_WS, {transports:['websocket','polling'],reconnectionDelay:1000})
    socket.on('connect', () => { setConnected(true); socket.emit('watch', tournamentId ?? 'demo-1') })
    socket.on('disconnect', () => setConnected(false))
    socket.on('game:state', (d:DemoState) => setState(d))
    socketRef.current = socket
    return () => { socket.disconnect() }
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => { setScale(entries[0].contentRect.width / CANVAS_W) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!state?.actions?.length) return
    const last = state.actions[0] // actions are prepended (newest first)
    const key = `${last.agent_name}:::${last.timestamp}:::${last.action}`
    if (key === lastActionKeyRef.current) return
    lastActionKeyRef.current = key
    const verb = last.action.toLowerCase().split(' ')[0]
    const color = ACTION_COLOR[verb] ?? 'rgba(150,150,150,0.92)'
    const text = last.amount ? `${last.action.toUpperCase()} $${last.amount.toLocaleString()}` : last.action.toUpperCase()
    const bubbleKey = Date.now()
    setBubbles(b => ({...b, [last.agent_name]: {text, color, key: bubbleKey}}))
    setTimeout(() => {
      setBubbles(b => {
        if (b[last.agent_name]?.key !== bubbleKey) return b
        const next = {...b}; delete next[last.agent_name]; return next
      })
    }, 3500)
  }, [state])

  if (!connected) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:480}}>
      <div style={{textAlign:'center'}}>
        <div style={{fontSize:48,marginBottom:16}} className="animate-pulse">🃏</div>
        <div className="font-display" style={{fontSize:22,color:'rgba(255,255,255,0.4)',marginBottom:8}}>Connecting...</div>
        <code style={{fontSize:11,color:'rgba(255,255,255,0.2)'}}>pnpm --filter server demo</code>
      </div>
    </div>
  )
  if (!state||!state.players.length) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:480}}>
      <div className="font-mono animate-pulse" style={{color:'rgba(255,255,255,0.25)'}}>Waiting for game...</div>
    </div>
  )

  const short = (n:string) => n.replace(/^[^\s]+\s/,'')

  return (
    <div style={{width:'100%',overflow:'visible'}}>
      <style>{`@keyframes bubblePop{0%{opacity:0;scale:0.5}60%{scale:1.12}100%{opacity:1;scale:1}}@keyframes winnerGlow{0%,100%{box-shadow:0 0 18px rgba(251,191,36,0.5)}50%{box-shadow:0 0 36px rgba(251,191,36,0.9)}}`}</style>

      {/* ── Top bar ── */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,marginBottom:16}}>
        {/* Left: live badge + hand + phase + winner */}
        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',flex:1}}>
          <div style={{display:'flex',alignItems:'center',gap:6,padding:'4px 10px',borderRadius:8,background:'rgba(16,185,129,0.08)',border:'1px solid rgba(16,185,129,0.3)'}}>
            <span style={{width:7,height:7,borderRadius:'50%',background:'#10b981',boxShadow:'0 0 6px #10b981',display:'inline-block'}}/>
            <span className="font-mono" style={{fontSize:10,fontWeight:700,color:'#10b981',letterSpacing:2}}>LIVE</span>
          </div>
          <span className="font-display" style={{fontSize:17,color:'rgba(255,255,255,0.8)'}}>
            Hand <span style={{color:'#22d3ee'}}>#{state.hand_number}</span>
          </span>
          <span className="font-mono" style={{fontSize:9,padding:'3px 8px',borderRadius:6,background:'rgba(255,255,255,0.05)',color:'rgba(255,255,255,0.35)',letterSpacing:2,textTransform:'uppercase'}}>
            {state.phase}
          </span>
          {state.status==='showdown'&&state.last_winners?.length?(
            <div style={{display:'flex',alignItems:'center',gap:6,padding:'4px 10px',borderRadius:8,background:'rgba(251,191,36,0.1)',border:'1px solid rgba(251,191,36,0.3)'}}>
              🏆<span className="font-ui" style={{fontSize:12,fontWeight:600,color:'#fbbf24'}}>{state.last_winners.map(w=>short(w.agent_name)).join(' · ')}</span>
            </div>
          ):null}
        </div>
        {/* Right: level/blinds/ante/next/players */}
        <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
          {[
            {l:'Level',v:String(state.blind_level)},
            {l:'Blinds',v:`${state.small_blind}/${state.big_blind}`},
            ...(state.ante>0?[{l:'Ante',v:String(state.ante)}]:[]),
            {l:'Next',v:`${Math.floor(state.next_level_in/60)}:${String(state.next_level_in%60).padStart(2,'0')}`,a:true},
            {l:'Players',v:`${state.players_remaining}/${state.total_players}`},
          ].map(item=>(
            <div key={item.l} style={{display:'flex',alignItems:'center',gap:5,padding:'4px 10px',borderRadius:8,background:'rgba(255,255,255,0.03)',border:(item as {a?:boolean}).a?'1px solid rgba(34,211,238,0.2)':'1px solid rgba(255,255,255,0.06)'}}>
              <span className="font-mono" style={{fontSize:9,letterSpacing:2,textTransform:'uppercase',color:'rgba(255,255,255,0.22)'}}>{item.l}</span>
              <span className="font-mono" style={{fontSize:12,fontWeight:600,color:(item as {a?:boolean}).a?'#22d3ee':'rgba(255,255,255,0.8)'}}>{item.v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Scaling wrapper ── */}
      <div ref={containerRef} style={{width:'100%',position:'relative',height:CANVAS_H*scale,overflow:'visible'}}>
        <div style={{
          position:'absolute',top:0,left:0,
          width:CANVAS_W,height:CANVAS_H,
          transformOrigin:'top left',
          transform:`scale(${scale})`,
          overflow:'visible',
        }}>

          {/* ── SVG table shape ── */}
          <svg viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} xmlns="http://www.w3.org/2000/svg" style={{position:'absolute',inset:0,width:'100%',height:'100%',overflow:'visible'}}>
            <defs>
              <linearGradient id="rail-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#686868"/><stop offset="10%"  stopColor="#404040"/>
                <stop offset="30%"  stopColor="#272727"/><stop offset="50%"  stopColor="#1c1c1c"/>
                <stop offset="70%"  stopColor="#272727"/><stop offset="90%"  stopColor="#404040"/>
                <stop offset="100%" stopColor="#686868"/>
              </linearGradient>
              <linearGradient id="ring-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#787878"/><stop offset="15%"  stopColor="#484848"/>
                <stop offset="50%"  stopColor="#1e1e1e"/><stop offset="85%"  stopColor="#484848"/>
                <stop offset="100%" stopColor="#787878"/>
              </linearGradient>
              <radialGradient id="felt-grad" cx="50%" cy="46%" r="58%">
                <stop offset="0%"   stopColor="#3a9e61"/><stop offset="40%"  stopColor="#2d8050"/>
                <stop offset="70%"  stopColor="#1f5e39"/><stop offset="100%" stopColor="#133d26"/>
              </radialGradient>
              <filter id="table-shadow" x="-8%" y="-8%" width="116%" height="116%">
                <feDropShadow dx="0" dy="12" stdDeviation="22" floodColor="rgba(0,0,0,0.9)"/>
              </filter>
            </defs>
            <rect x="35" y="115" width="830" height="470" rx="235" fill="rgba(0,0,0,0.7)" filter="url(#table-shadow)"/>
            <rect x="35" y="115" width="830" height="470" rx="235" fill="url(#rail-grad)"/>
            <rect x="44" y="124" width="812" height="452" rx="226" fill="url(#ring-grad)"/>
            <rect x="58" y="138" width="784" height="424" rx="212" fill="url(#felt-grad)"/>
          </svg>

          {/* ── Pot + community cards ── */}
          <div style={{position:'absolute',top:310,left:450,transform:'translate(-50%,-50%)',display:'flex',flexDirection:'column',alignItems:'center',gap:8,zIndex:10}}>
            <div style={{display:'flex',alignItems:'center',gap:6,padding:'4px 14px',borderRadius:20,background:'rgba(0,0,0,0.55)',border:'1px solid rgba(255,255,255,0.1)',backdropFilter:'blur(8px)',marginBottom:2}}>
              <div style={{width:11,height:11,borderRadius:'50%',background:'linear-gradient(135deg,#fbbf24,#f59e0b)',boxShadow:'0 0 6px rgba(251,191,36,0.5)',flexShrink:0}}/>
              <span className="font-mono" style={{fontSize:13,fontWeight:700,color:'#fbbf24',whiteSpace:'nowrap'}}>
                Pot: {state.pot>0?`$${state.pot.toLocaleString()}`:'—'}
              </span>
            </div>
            <div style={{display:'flex',gap:6,minHeight:80}}>
              {state.community_cards.map((card,i)=>(
                <Card key={i} card={card as {rank:number;suit:string}} w={56} h={80}/>
              ))}
            </div>
          </div>

          {/* ── Action bubbles ── */}
          {state.players.map((p,i)=>{
            if (p.chips === 0 && !p.is_all_in) return null
            const bubble = bubbles[p.agent_name]
            if (!bubble) return null
            const seat = SEATS_6[i%SEATS_6.length]
            return (
              <div key={`bubble-${p.agent_id}-${bubble.key}`} style={{
                position:'absolute',left:seat.bubble.x,top:seat.bubble.y,
                transform:'translate(-50%,-50%)',
                zIndex:40,pointerEvents:'none',
              }}>
                <div style={{
                  padding:'5px 14px',borderRadius:24,
                  background:bubble.color,
                  boxShadow:'0 3px 14px rgba(0,0,0,0.6)',
                  fontFamily:'ui-monospace,SFMono-Regular,monospace',
                  fontSize:13,fontWeight:900,color:'#000',
                  whiteSpace:'nowrap',letterSpacing:0.8,
                  animation:'bubblePop 0.25s ease-out both',
                }}>
                  {bubble.text}
                </div>
              </div>
            )
          })}

          {/* ── Bet chips ── */}
          {state.players.map((p,i)=>{
            if (!p.bet_this_round||p.is_folded) return null
            const seat = SEATS_6[i%SEATS_6.length]
            return (
              <div key={`bet-${p.agent_id}`} style={{position:'absolute',left:seat.bet.x,top:seat.bet.y,transform:'translate(-50%,-50%)',zIndex:35,display:'flex',alignItems:'center',gap:5,pointerEvents:'none'}}>
                <div style={{width:22,height:22,borderRadius:'50%',flexShrink:0,background:'linear-gradient(145deg,#e8c84a,#c9a832)',border:'3px solid rgba(255,255,255,0.5)',boxShadow:'0 2px 6px rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <div style={{width:10,height:10,borderRadius:'50%',background:'rgba(255,255,255,0.25)',border:'1px solid rgba(255,255,255,0.4)'}}/>
                </div>
                <span style={{fontSize:12,fontWeight:700,color:'#fff',fontFamily:'Arial,sans-serif',textShadow:'0 1px 3px rgba(0,0,0,0.8)',whiteSpace:'nowrap'}}>{p.bet_this_round.toLocaleString()}</span>
              </div>
            )
          })}

          {/* ── Player cards (rendered independently, always above nameplate) ── */}
          {state.players.map((p,i)=>{
            if (p.chips === 0 && !p.is_all_in) return null
            const seat = SEATS_6[i%SEATS_6.length]
            return (
              <div key={`cards-${p.agent_id}`} style={{
                position:'absolute',
                left:seat.cards.x, top:seat.cards.y,
                transform:`translate(${seat.cards.tx},${seat.cards.ty})`,
                display:'flex', flexDirection:'row', gap:4,
                zIndex:30,
                opacity:p.is_folded?0.2:1,
                filter:p.is_folded?'grayscale(0.8)':'none',
                transition:'opacity 0.4s',
              }}>
                {p.hole_cards.length>0
                  ? p.hole_cards.map((c,ci)=><Card key={ci} card={c} w={44} h={63}/>)
                  : [0,1].map(ci=><Card key={ci} back w={44} h={63}/>)
                }
              </div>
            )
          })}

          {/* ── Nameplates ── */}
          {state.players.map((p,i)=>{
            if (p.chips === 0 && !p.is_all_in) return null
            const seat = SEATS_6[i%SEATS_6.length]
            const isActive = p.is_current_turn && !p.is_folded
            const winnerInfo = state.status==='showdown' ? state.last_winners?.find(w=>w.agent_name===p.agent_name) : undefined
            const isWinner = !!winnerInfo
            return (
              <div key={`plate-${p.agent_id}`} style={{
                position:'absolute',
                left:seat.nameplate.x, top:seat.nameplate.y,
                transform:`translate(${seat.nameplate.tx},${seat.nameplate.ty})`,
                zIndex:31,
                opacity: p.is_folded && !isWinner ? 0.35 : 1,
                transition:'opacity 0.4s',
              }}>
                <div style={{
                  display:'flex',alignItems:'center',gap:8,
                  padding:'6px 12px 6px 8px',borderRadius:10,
                  background:isWinner?'rgba(251,191,36,0.18)':isActive?'rgba(34,211,238,0.15)':'rgba(5,12,8,0.92)',
                  border:isWinner?'1.5px solid rgba(251,191,36,0.8)':isActive?'1.5px solid rgba(34,211,238,0.65)':'1px solid rgba(255,255,255,0.14)',
                  boxShadow:isActive?'0 0 20px rgba(34,211,238,0.28)':'0 2px 12px rgba(0,0,0,0.6)',
                  animation:isWinner?'winnerGlow 1s ease-in-out infinite':undefined,
                  backdropFilter:'blur(14px)',
                  minWidth:130,overflow:'hidden',position:'relative',
                }}>
                  {isActive&&(
                    <div style={{position:'absolute',top:0,left:0,right:0,height:2.5,background:'rgba(255,255,255,0.07)'}}>
                      <div style={{height:'100%',width:`${(p.time_remaining/15)*100}%`,background:p.time_remaining>5?'#22d3ee':'#f43f5e',boxShadow:`0 0 5px ${p.time_remaining>5?'#22d3ee':'#f43f5e'}`,transition:'width 1s linear, background 0.3s'}}/>
                    </div>
                  )}
                  <div style={{width:32,height:32,borderRadius:'50%',flexShrink:0,background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,position:'relative'}}>
                    {p.emoji}
                    {p.is_dealer&&(
                      <div style={{position:'absolute',bottom:-4,right:-4,width:16,height:16,borderRadius:'50%',background:'linear-gradient(145deg,#f5f5f5,#d0d0d0)',border:'1.5px solid #888',boxShadow:'0 1px 4px rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                        <span style={{fontSize:8,fontWeight:900,color:'#111',fontFamily:'Arial Black,Arial,sans-serif',lineHeight:1}}>D</span>
                      </div>
                    )}
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:2}}>
                    <div style={{display:'flex',alignItems:'center',gap:4}}>
                      <div style={{fontSize:13,fontWeight:700,fontFamily:'system-ui,-apple-system,sans-serif',color:isWinner?'#fbbf24':isActive?'#22d3ee':'#ffffff',maxWidth:75,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',letterSpacing:0.2}}>
                        {short(p.agent_name)}
                      </div>
                      {p.is_small_blind&&<span style={{fontSize:8,fontWeight:800,padding:'1px 4px',borderRadius:3,background:'#22d3ee',color:'#000',flexShrink:0,fontFamily:'monospace'}}>SB</span>}
                      {p.is_big_blind&&<span style={{fontSize:8,fontWeight:800,padding:'1px 4px',borderRadius:3,background:'#8b5cf6',color:'#fff',flexShrink:0,fontFamily:'monospace'}}>BB</span>}
                    </div>
                    <div style={{fontSize:13,fontWeight:600,fontFamily:'ui-monospace,SFMono-Regular,monospace',color:'rgba(255,255,255,0.7)',letterSpacing:0.5,display:'flex',alignItems:'center',gap:5}}>
                      ${p.chips.toLocaleString()}
                      {p.is_all_in&&<span style={{fontSize:8,fontWeight:800,padding:'1px 5px',borderRadius:3,background:'#f97316',color:'#000',flexShrink:0,fontFamily:'monospace',letterSpacing:1}}>ALL IN</span>}
                      {isWinner&&<span style={{fontSize:8,fontWeight:800,padding:'1px 5px',borderRadius:3,background:'#fbbf24',color:'#000',flexShrink:0,fontFamily:'monospace',letterSpacing:1}}>+${winnerInfo!.amount.toLocaleString()}</span>}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}

        </div>
      </div>

    </div>
  )
}
