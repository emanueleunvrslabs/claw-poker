'use client'
import { useState, useRef, useCallback, useEffect } from 'react'

const CANVAS_W = 900
const CANVAS_H = 700

type Point = { x: number; y: number }
type SeatPos = {
  cards:     Point
  nameplate: Point
  bet:       Point
  dealer:    Point
  bubble:    Point
}

// cards/nameplate rendered independently — all cards horizontal (row)
// transforms per seat are fixed (define how element anchors to its point):
//   bottom seats:  cards bottom at point (ty=-100%), nameplate top at point (ty=0%)
//   top seats:     cards top at point (ty=0%),     nameplate bottom at point (ty=-100%)
//   right seat:    cards left at point (tx=0%),    nameplate right at point (tx=-100%)
//   left seat:     cards right at point (tx=-100%), nameplate left at point (tx=0%)
const CARDS_TX     = ['-50%','-50%', '0%','-50%','-50%','-100%']
const CARDS_TY     = ['-100%','-100%','-50%','0%','0%','-50%']
const PLATE_TX     = ['-50%','-50%','-100%','-50%','-50%','0%']
const PLATE_TY     = ['0%','0%','-50%','-100%','-100%','-50%']

const INITIAL: SeatPos[] = [
  { // 0 bottom-left
    cards:     {x:270, y:585},
    nameplate: {x:270, y:591},
    bet:       {x:342, y:506},
    dealer:    {x:314, y:575},
    bubble:    {x:342, y:465},
  },
  { // 1 bottom-right
    cards:     {x:630, y:585},
    nameplate: {x:630, y:591},
    bet:       {x:558, y:506},
    dealer:    {x:586, y:575},
    bubble:    {x:558, y:465},
  },
  { // 2 right
    cards:     {x:870, y:350},
    nameplate: {x:862, y:350},
    bet:       {x:714, y:350},
    dealer:    {x:848, y:325},
    bubble:    {x:714, y:315},
  },
  { // 3 top-right
    cards:     {x:630, y:115},
    nameplate: {x:630, y:121},
    bet:       {x:558, y:244},
    dealer:    {x:586, y:125},
    bubble:    {x:558, y:282},
  },
  { // 4 top-left
    cards:     {x:270, y:115},
    nameplate: {x:270, y:121},
    bet:       {x:342, y:244},
    dealer:    {x:314, y:125},
    bubble:    {x:342, y:282},
  },
  { // 5 left
    cards:     {x:30,  y:350},
    nameplate: {x:38,  y:350},
    bet:       {x:186, y:350},
    dealer:    {x:52,  y:325},
    bubble:    {x:186, y:315},
  },
]

const SEAT_COLORS = ['#f87171','#fb923c','#34d399','#60a5fa','#a78bfa','#f472b6']
const SEAT_NAMES  = ['0 BL','1 BR','2 R','3 TR','4 TL','5 L']
const MOCK_NAMES  = ['RandomBot','TightBot','AggressBot','GTO_Agent','CallerBot','BluffBot']
const MOCK_EMOJIS = ['🤖','🎯','💥','📐','📞','🎭']

type HandleKey = 'cards' | 'nameplate' | 'bet' | 'dealer' | 'bubble'
const HANDLE_STYLES: Record<HandleKey,{color:string;label:string;size:number}> = {
  cards:     {color:'#e63946', label:'C', size:14},
  nameplate: {color:'#fff',    label:'N', size:14},
  bet:       {color:'#fbbf24', label:'$', size:12},
  dealer:    {color:'#94a3b8', label:'D', size:10},
  bubble:    {color:'#f97316', label:'B', size:12},
}

function CardBack({w=44,h=63}:{w?:number;h?:number}) {
  return (
    <div style={{width:w,height:h,borderRadius:6,flexShrink:0,background:'linear-gradient(160deg,#1e4080 0%,#0f2550 50%,#071830 100%)',border:'2px solid rgba(60,120,220,0.4)',boxShadow:'0 4px 16px rgba(0,0,0,0.8)',display:'flex',alignItems:'center',justifyContent:'center',position:'relative',overflow:'hidden'}}>
      <div style={{position:'absolute',inset:3,borderRadius:4,border:'1px solid rgba(230,57,70,0.2)',backgroundImage:'repeating-linear-gradient(45deg,rgba(230,57,70,0.05) 0px,rgba(230,57,70,0.05) 2px,transparent 2px,transparent 8px)'}}/>
      <span style={{fontSize:w*0.4,opacity:0.35,color:'#60a5fa',position:'relative'}}>♠</span>
    </div>
  )
}

function Nameplate({name,emoji,chips,active}:{name:string;emoji:string;chips:number;active?:boolean}) {
  return (
    <div style={{display:'flex',alignItems:'center',gap:7,padding:'5px 10px 5px 6px',borderRadius:10,background:active?'rgba(230,57,70,0.15)':'rgba(5,12,8,0.88)',border:active?'1.5px solid rgba(230,57,70,0.65)':'1px solid rgba(255,255,255,0.14)',boxShadow:active?'0 0 20px rgba(230,57,70,0.28)':'0 2px 12px rgba(0,0,0,0.6)',backdropFilter:'blur(14px)',width:140,flexShrink:0,position:'relative',overflow:'hidden'}}>
      {active&&<div style={{position:'absolute',top:0,left:0,right:0,height:2.5,background:'rgba(230,57,70,0.4)'}}/>}
      <div style={{width:30,height:30,borderRadius:'50%',flexShrink:0,background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:15}}>{emoji}</div>
      <div style={{display:'flex',flexDirection:'column',gap:1}}>
        <div style={{fontSize:12,fontWeight:700,fontFamily:'system-ui,sans-serif',color:active?'#e63946':'rgba(255,255,255,0.95)',maxWidth:82,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{name}</div>
        <div style={{fontSize:12,fontWeight:600,fontFamily:'ui-monospace,monospace',color:'rgba(255,255,255,0.65)'}}>{chips.toLocaleString()}</div>
      </div>
    </div>
  )
}

const LS_KEY = 'claw-poker-editor-seats'

function cloneSeat(s: SeatPos): SeatPos {
  return {cards:{...s.cards},nameplate:{...s.nameplate},bet:{...s.bet},dealer:{...s.dealer},bubble:{...s.bubble}}
}

function loadSeats(): SeatPos[] {
  try {
    const saved = typeof window !== 'undefined' && localStorage.getItem(LS_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as SeatPos[]
      // migrate old saves without bubble field
      return parsed.map((s, i) => ({
        ...cloneSeat({...INITIAL[i], ...s}),
        bubble: s.bubble ?? {...INITIAL[i].bubble},
      }))
    }
  } catch {}
  return INITIAL.map(cloneSeat)
}

export default function TableEditor() {
  const [seats, setSeats] = useState<SeatPos[]>(()=>loadSeats())
  const [scale, setScale] = useState(1)
  const [dragging, setDragging] = useState<{si:number;key:HandleKey}|null>(null)
  const [hovering, setHovering] = useState<{si:number;key:HandleKey}|null>(null)
  const [copied, setCopied] = useState(false)
  const [showHandles, setShowHandles] = useState(true)

  // persist on every change
  useEffect(()=>{ localStorage.setItem(LS_KEY, JSON.stringify(seats)) }, [seats])
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  useEffect(()=>{
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries=>{ setScale(entries[0].contentRect.width / CANVAS_W) })
    ro.observe(el)
    return ()=>ro.disconnect()
  },[])

  const getCanvasXY = useCallback((e:MouseEvent)=>{
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return null
    return { x:Math.round((e.clientX-rect.left)/scale), y:Math.round((e.clientY-rect.top)/scale) }
  },[scale])

  const onMouseDown = useCallback((si:number,key:HandleKey,e:React.MouseEvent)=>{
    e.preventDefault(); e.stopPropagation(); setDragging({si,key})
  },[])

  useEffect(()=>{
    if (!dragging) return
    const onMove=(e:MouseEvent)=>{
      const pt=getCanvasXY(e); if(!pt) return
      setSeats(prev=>{
        const next=prev.map(cloneSeat)
        next[dragging.si][dragging.key]=pt; return next
      })
    }
    const onUp=()=>setDragging(null)
    window.addEventListener('mousemove',onMove); window.addEventListener('mouseup',onUp)
    return ()=>{ window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp) }
  },[dragging,getCanvasXY])

  const generateCode = ()=>{
    const lines=seats.map((s,i)=>`  { // ${i} — ${SEAT_NAMES[i]}
    cards:     {x:${s.cards.x}, y:${s.cards.y}, tx:'${CARDS_TX[i]}', ty:'${CARDS_TY[i]}'},
    nameplate: {x:${s.nameplate.x}, y:${s.nameplate.y}, tx:'${PLATE_TX[i]}', ty:'${PLATE_TY[i]}'},
    bet:       {x:${s.bet.x}, y:${s.bet.y}},
    dealer:    {x:${s.dealer.x}, y:${s.dealer.y}},
    bubble:    {x:${s.bubble.x}, y:${s.bubble.y}},
  },`)
    return `const SEATS_6 = [\n${lines.join('\n')}\n]`
  }

  const copyCode=()=>{ navigator.clipboard.writeText(generateCode()); setCopied(true); setTimeout(()=>setCopied(false),2000) }
  const resetSeats=()=>{ const s=INITIAL.map(cloneSeat); setSeats(s); localStorage.setItem(LS_KEY,JSON.stringify(s)) }

  return (
    <div style={{minHeight:'100vh',background:'#0a0f0a',padding:24,fontFamily:'monospace',color:'#fff'}}>
      <div style={{maxWidth:1300,margin:'0 auto'}}>

        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16,flexWrap:'wrap'}}>
          <span style={{fontSize:18,fontWeight:700,color:'#e63946'}}>Table Position Editor</span>
          <span style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>Drag handles — C=cards N=nameplate $=bet D=dealer B=bubble</span>
          <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12,color:'rgba(255,255,255,0.5)',userSelect:'none'}}>
            <input type="checkbox" checked={showHandles} onChange={e=>setShowHandles(e.target.checked)} style={{accentColor:'#e63946'}}/>
            Handles
          </label>
          <div style={{marginLeft:'auto',display:'flex',gap:8}}>
            <button onClick={resetSeats} style={{padding:'8px 14px',borderRadius:8,border:'1px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.04)',color:'rgba(255,255,255,0.4)',cursor:'pointer',fontSize:12}}>
              Reset
            </button>
            <button onClick={copyCode} style={{padding:'8px 20px',borderRadius:8,border:'1px solid rgba(230,57,70,0.4)',background:copied?'rgba(230,57,70,0.2)':'rgba(230,57,70,0.08)',color:copied?'#e63946':'rgba(255,255,255,0.7)',cursor:'pointer',fontSize:13,fontWeight:600}}>
              {copied?'✓ Copied!':'Copy SEATS_6 code'}
            </button>
          </div>
        </div>

        <div style={{display:'flex',gap:20,alignItems:'flex-start'}}>

          <div ref={containerRef} style={{flex:1,minWidth:0,position:'relative',height:CANVAS_H*scale}}>
            <div ref={canvasRef} style={{position:'absolute',top:0,left:0,width:CANVAS_W,height:CANVAS_H,transformOrigin:'top left',transform:`scale(${scale})`,cursor:dragging?'grabbing':'default',userSelect:'none',overflow:'visible'}}>

              {/* SVG table */}
              <svg viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} style={{position:'absolute',inset:0,width:'100%',height:'100%'}}>
                <defs>
                  <linearGradient id="rail-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#686868"/><stop offset="50%" stopColor="#1c1c1c"/><stop offset="100%" stopColor="#686868"/>
                  </linearGradient>
                  <linearGradient id="ring-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#787878"/><stop offset="50%" stopColor="#1e1e1e"/><stop offset="100%" stopColor="#787878"/>
                  </linearGradient>
                  <radialGradient id="felt-grad" cx="50%" cy="46%" r="58%">
                    <stop offset="0%" stopColor="#3a9e61"/><stop offset="60%" stopColor="#1f5e39"/><stop offset="100%" stopColor="#133d26"/>
                  </radialGradient>
                  <filter id="tshadow" x="-8%" y="-8%" width="116%" height="116%">
                    <feDropShadow dx="0" dy="12" stdDeviation="22" floodColor="rgba(0,0,0,0.9)"/>
                  </filter>
                </defs>
                <rect x="35" y="115" width="830" height="470" rx="235" fill="rgba(0,0,0,0.7)" filter="url(#tshadow)"/>
                <rect x="35" y="115" width="830" height="470" rx="235" fill="url(#rail-grad)"/>
                <rect x="44" y="124" width="812" height="452" rx="226" fill="url(#ring-grad)"/>
                <rect x="58" y="138" width="784" height="424" rx="212" fill="url(#felt-grad)"/>
              </svg>

              {/* Pot + community cards placeholder */}
              <div style={{position:'absolute',top:310,left:450,transform:'translate(-50%,-50%)',display:'flex',flexDirection:'column',alignItems:'center',gap:8,zIndex:10,pointerEvents:'none'}}>
                <div style={{display:'flex',alignItems:'center',gap:6,padding:'4px 14px',borderRadius:20,background:'rgba(0,0,0,0.55)',border:'1px solid rgba(255,255,255,0.1)'}}>
                  <div style={{width:11,height:11,borderRadius:'50%',background:'linear-gradient(135deg,#fbbf24,#f59e0b)',flexShrink:0}}/>
                  <span style={{fontSize:13,fontWeight:700,color:'#fbbf24',fontFamily:'monospace'}}>Pot: $1,250</span>
                </div>
                <div style={{display:'flex',gap:6}}>
                  {[0,1,2,3,4].map(i=><div key={i} style={{width:56,height:80,borderRadius:6,background:'rgba(255,255,255,0.06)',border:'1px dashed rgba(255,255,255,0.12)'}}/>)}
                </div>
              </div>

              {/* Cards — independent */}
              {seats.map((seat,si)=>(
                <div key={`cards-${si}`} style={{position:'absolute',left:seat.cards.x,top:seat.cards.y,transform:`translate(${CARDS_TX[si]},${CARDS_TY[si]})`,display:'flex',flexDirection:'row',gap:4,zIndex:20,pointerEvents:'none',outline:`1.5px dashed ${SEAT_COLORS[si]}55`,outlineOffset:2}}>
                  <CardBack/><CardBack/>
                </div>
              ))}

              {/* Nameplates — independent */}
              {seats.map((seat,si)=>(
                <div key={`plate-${si}`} style={{position:'absolute',left:seat.nameplate.x,top:seat.nameplate.y,transform:`translate(${PLATE_TX[si]},${PLATE_TY[si]})`,zIndex:20,pointerEvents:'none',outline:`1.5px dashed ${SEAT_COLORS[si]}55`,outlineOffset:2}}>
                  <Nameplate name={MOCK_NAMES[si]} emoji={MOCK_EMOJIS[si]} chips={1500-si*100} active={si===2}/>
                </div>
              ))}

              {/* Bet chips */}
              {seats.map((seat,si)=>(
                <div key={`bet-${si}`} style={{position:'absolute',left:seat.bet.x,top:seat.bet.y,transform:'translate(-50%,-50%)',zIndex:25,display:'flex',alignItems:'center',gap:5,pointerEvents:'none'}}>
                  <div style={{width:22,height:22,borderRadius:'50%',background:'linear-gradient(145deg,#e8c84a,#c9a832)',border:'3px solid rgba(255,255,255,0.5)',boxShadow:'0 2px 6px rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                    <div style={{width:10,height:10,borderRadius:'50%',background:'rgba(255,255,255,0.25)'}}/>
                  </div>
                  <span style={{fontSize:12,fontWeight:700,color:'#fff',textShadow:'0 1px 3px rgba(0,0,0,0.8)',fontFamily:'monospace'}}>150</span>
                </div>
              ))}

              {/* Dealer buttons */}
              {seats.map((seat,si)=>(
                <div key={`dealer-${si}`} style={{position:'absolute',left:seat.dealer.x,top:seat.dealer.y,transform:'translate(-50%,-50%)',zIndex:26,width:24,height:24,borderRadius:'50%',background:'linear-gradient(145deg,#f5f5f5,#d8d8d8)',border:'2px solid #999',boxShadow:'0 2px 6px rgba(0,0,0,0.55)',display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none'}}>
                  <span style={{fontSize:10,fontWeight:900,color:'#222',fontFamily:'Arial Black,Arial',lineHeight:1}}>D</span>
                </div>
              ))}

              {/* Bubble previews */}
              {seats.map((seat,si)=>(
                <div key={`bubble-${si}`} style={{position:'absolute',left:seat.bubble.x,top:seat.bubble.y,transform:'translate(-50%,-50%)',zIndex:27,pointerEvents:'none'}}>
                  <div style={{padding:'4px 10px',borderRadius:20,background:'rgba(249,115,22,0.85)',boxShadow:'0 2px 8px rgba(0,0,0,0.5)',fontSize:11,fontWeight:900,color:'#000',fontFamily:'monospace',whiteSpace:'nowrap'}}>
                    RAISE $60
                  </div>
                </div>
              ))}

              {/* Drag handles */}
              {showHandles && seats.map((seat,si)=>
                (Object.keys(HANDLE_STYLES) as HandleKey[]).map(key=>{
                  const pt = seat[key]
                  const hs = HANDLE_STYLES[key]
                  const isHov = hovering?.si===si && hovering?.key===key
                  const isDrag = dragging?.si===si && dragging?.key===key
                  const r = hs.size/2
                  return (
                    <div key={`${si}-${key}`}
                      onMouseDown={e=>onMouseDown(si,key,e)}
                      onMouseEnter={()=>setHovering({si,key})}
                      onMouseLeave={()=>setHovering(null)}
                      title={`Seat ${si} ${key}: x=${pt.x} y=${pt.y}`}
                      style={{position:'absolute',left:pt.x-r,top:pt.y-r,width:hs.size,height:hs.size,borderRadius:'50%',background:isDrag||isHov?hs.color:`${hs.color}bb`,border:`2px solid ${SEAT_COLORS[si]}`,boxShadow:`0 0 ${isDrag?14:isHov?8:4}px ${SEAT_COLORS[si]}`,cursor:'grab',display:'flex',alignItems:'center',justifyContent:'center',fontSize:Math.max(7,hs.size*0.5),fontWeight:900,color:'#000',zIndex:isDrag?100:60,transform:isDrag||isHov?'scale(1.5)':'scale(1)',transition:'transform 0.1s,box-shadow 0.1s'}}
                    >
                      {hs.label}
                    </div>
                  )
                })
              )}

            </div>
          </div>

          {/* Coords panel */}
          <div style={{width:200,flexShrink:0,background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:12,padding:14,fontSize:11}}>
            <div style={{fontSize:12,fontWeight:700,color:'rgba(255,255,255,0.5)',marginBottom:10}}>Coordinates</div>
            {seats.map((seat,si)=>(
              <div key={si} style={{marginBottom:10,paddingBottom:10,borderBottom:'1px solid rgba(255,255,255,0.05)'}}>
                <div style={{color:SEAT_COLORS[si],fontWeight:700,marginBottom:4}}>{SEAT_NAMES[si]}</div>
                {(Object.keys(HANDLE_STYLES) as HandleKey[]).map(key=>{
                  const pt=seat[key]
                  const isActive=(hovering?.si===si&&hovering?.key===key)||(dragging?.si===si&&dragging?.key===key)
                  return (
                    <div key={key} style={{display:'flex',justifyContent:'space-between',marginBottom:2,color:isActive?'#e63946':'rgba(255,255,255,0.4)'}}>
                      <span style={{color:HANDLE_STYLES[key].color}}>{key[0].toUpperCase()}:</span>
                      <span style={{background:'rgba(0,0,0,0.3)',padding:'1px 5px',borderRadius:3}}>{pt.x},{pt.y}</span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

        </div>

        <div style={{marginTop:16,background:'rgba(0,0,0,0.4)',border:'1px solid rgba(255,255,255,0.07)',borderRadius:10,padding:14,overflow:'auto',maxHeight:240}}>
          <pre style={{fontSize:11,color:'rgba(255,255,255,0.55)',margin:0,lineHeight:1.6}}>{generateCode()}</pre>
        </div>

      </div>
    </div>
  )
}
