'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useMetaMask } from '@/lib/useMetaMask'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3010'

interface Tournament {
  id: string
  name: string
  type: string
  buy_in: number
  rake_percent: number
  prize_pool: number
  current_players: number
  max_players: number
  min_players: number
  status: string
  is_free: boolean
  starting_chips: number
  blind_structure: { level: number; small_blind: number; big_blind: number }[]
}

const BUY_IN_TABS = [0, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2500, 5000]

function formatBuyIn(v: number) {
  if (v === 0) return 'Free'
  if (v >= 1000) return `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K`
  return `$${v}`
}

function formatChips(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`
  return String(n)
}

function getBlinds(t: Tournament): string {
  const bs = Array.isArray(t.blind_structure) ? t.blind_structure : []
  const lvl1 = bs.find((b) => b.level === 1) ?? bs[0]
  if (!lvl1) return '—'
  return `${lvl1.small_blind}/${lvl1.big_blind}`
}

function getPrize(t: Tournament): string {
  if (t.is_free) return 'No prize'
  if (t.prize_pool > 0) return `$${t.prize_pool.toFixed(2)}`
  // estimate: buy_in * max_players * (1 - rake/100)
  const est = t.buy_in * t.max_players * (1 - (t.rake_percent ?? 10) / 100)
  return `~$${est.toFixed(0)}`
}

const STATUS_BADGE: Record<string, { label: string; color: string; dot: string }> = {
  registering: { label: 'Open', color: '#22d3ee', dot: '#22d3ee' },
  running:     { label: 'Running', color: '#10b981', dot: '#10b981' },
  finished:    { label: 'Ended', color: 'rgba(255,255,255,0.3)', dot: 'rgba(255,255,255,0.2)' },
  cancelled:   { label: 'Cancelled', color: '#f43f5e', dot: '#f43f5e' },
}

export default function LobbyPage() {
  const { address, isConnected, connectWallet } = useMetaMask()
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<number | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'registering' | 'running'>('all')
  const [joinTarget, setJoinTarget] = useState<Tournament | null>(null)
  const [joinEntries, setJoinEntries] = useState<{ agent_id: string; registered_by?: string; agents?: { name: string; agent_type: string }; users?: { display_name: string | null; wallet_address: string } }[]>([])
  const [joining, setJoining] = useState(false)
  const [joinResult, setJoinResult] = useState<{ ok: boolean; msg: string; agentName?: string } | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(() => {
    fetch(`${API_URL}/api/tournaments?limit=100`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setTournaments(Array.isArray(data) ? data : []))
      .catch(() => setTournaments([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    const iv = setInterval(load, 10000)
    return () => clearInterval(iv)
  }, [load])

  // Fetch user balance when connected
  useEffect(() => {
    if (!address) { setBalance(null); return }
    fetch(`${API_URL}/api/users?wallet=${address}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => data ? setBalance(data.balance_usdc ?? 0) : null)
      .catch(() => {})
  }, [address])

  // Fetch entries when modal opens, then poll every 3s
  useEffect(() => {
    if (!joinTarget) { setJoinEntries([]); return }
    const fetchEntries = () => {
      fetch(`${API_URL}/api/tournaments/${joinTarget.id}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => data?.entries ? setJoinEntries(data.entries) : null)
        .catch(() => {})
    }
    fetchEntries()
    const iv = setInterval(fetchEntries, 3000)
    return () => clearInterval(iv)
  }, [joinTarget])

  // Start 30s countdown when table becomes full
  useEffect(() => {
    if (!joinTarget || joinEntries.length < joinTarget.max_players) {
      // Table not full: clear any running countdown
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
      setCountdown(null)
      return
    }
    // Table just became full — start countdown if not already running
    if (countdownRef.current) return
    setCountdown(30)
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev === null || prev <= 1) {
          if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
          return null
        }
        return prev - 1
      })
    }, 1000)
    return () => {
      if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
    }
  }, [joinTarget, joinEntries.length])

  const filtered = tournaments.filter((t) => {
    if (t.status === 'cancelled' || t.status === 'finished') return false
    if (statusFilter !== 'all' && t.status !== statusFilter) return false
    if (activeTab === 'all') return true
    if (activeTab === 0) return t.is_free
    return !t.is_free && t.buy_in === activeTab
  })

  const running = tournaments.filter((t) => t.status === 'running').length
  const open = tournaments.filter((t) => t.status === 'registering').length

  const handleJoin = async () => {
    if (!joinTarget || !address) return
    setJoining(true)
    setJoinResult(null)
    try {
      const eth = (window as any).ethereum
      if (!eth) { setJoinResult({ ok: false, msg: 'MetaMask not found' }); setJoining(false); return }

      const timestamp = Math.floor(Date.now() / 1000)
      const message = `Join tournament ${joinTarget.id}\nWallet: ${address}\nTimestamp: ${timestamp}`
      let signature: string
      try {
        signature = await eth.request({ method: 'personal_sign', params: [message, address] })
      } catch {
        setJoinResult({ ok: false, msg: 'Signature cancelled' }); setJoining(false); return
      }

      const res = await fetch(`${API_URL}/api/tournaments/${joinTarget.id}/join-as-owner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: address, signature, timestamp }),
      })
      const data = await res.json()
      if (res.ok) {
        setJoinResult({ ok: true, msg: `Joined! Your bot ${data.agent_name ?? ''} is registered.`, agentName: data.agent_name })
        setBalance(prev => prev !== null ? prev - (joinTarget.buy_in ?? 0) : null)
        load()
      } else {
        setJoinResult({ ok: false, msg: data.error ?? 'Failed to join' })
      }
    } catch {
      setJoinResult({ ok: false, msg: 'Network error' })
    }
    setJoining(false)
  }

  return (
    <div className="min-h-screen pt-28 pb-16 px-6">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="mb-8 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-6xl font-light mb-1" style={{ color: 'rgba(255,255,255,0.95)' }}>
              Tournament <span className="italic" style={{ color: '#22d3ee' }}>Lobby</span>
            </h1>
            <p className="font-ui text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {running} running · {open} open
            </p>
          </div>
          <button
            onClick={() => window.open('/table/demo-1/1', 'demo-table', 'popup,width=1280,height=820,resizable=yes')}
            className="glass-button shrink-0 px-5 py-2.5 rounded-xl text-sm font-ui font-semibold flex items-center gap-2"
            style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.35)', color: '#10b981', cursor: 'pointer' }}
          >
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#10b981' }} />
            Watch Live Demo
          </button>
        </div>

        {/* Buy-in tabs */}
        <div className="flex gap-2 flex-wrap mb-6">
          <TabBtn label="All" active={activeTab === 'all'} onClick={() => setActiveTab('all')} />
          {BUY_IN_TABS.map((b) => (
            <TabBtn key={b} label={formatBuyIn(b)} active={activeTab === b} onClick={() => setActiveTab(b)} />
          ))}
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-3 mb-6">
          <span className="font-mono text-[10px] tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.25)' }}>Show:</span>
          {([
            { key: 'all',         label: 'All',  dot: null },
            { key: 'registering', label: 'Open', dot: '#22d3ee' },
            { key: 'running',     label: 'Live', dot: '#10b981' },
          ] as const).map(({ key, label, dot }) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-mono font-medium transition-all duration-150"
              style={statusFilter === key ? {
                background: key === 'running' ? 'rgba(16,185,129,0.12)' : key === 'registering' ? 'rgba(34,211,238,0.12)' : 'rgba(255,255,255,0.08)',
                border: `1px solid ${key === 'running' ? 'rgba(16,185,129,0.35)' : key === 'registering' ? 'rgba(34,211,238,0.35)' : 'rgba(255,255,255,0.2)'}`,
                color: key === 'running' ? '#10b981' : key === 'registering' ? '#22d3ee' : 'rgba(255,255,255,0.8)',
                cursor: 'pointer',
              } : {
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
                color: 'rgba(255,255,255,0.35)',
                cursor: 'pointer',
              }}
            >
              {dot && (
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: dot, boxShadow: statusFilter === key && key === 'running' ? `0 0 6px ${dot}` : 'none' }}
                />
              )}
              {label}
              <span className="ml-0.5 font-mono text-[10px]" style={{ color: 'inherit', opacity: 0.6 }}>
                {key === 'all' ? tournaments.filter(t => t.status === 'running' || t.status === 'registering').length
                  : tournaments.filter(t => t.status === key).length}
              </span>
            </button>
          ))}
        </div>

        {/* Data grid */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}
        >
          {/* Grid header */}
          <div
            className="grid font-mono text-[10px] tracking-widest uppercase px-5 py-3"
            style={{
              gridTemplateColumns: '2fr 90px 90px 90px 100px 100px 120px 120px',
              color: 'rgba(255,255,255,0.28)',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              background: 'rgba(0,0,0,0.2)',
            }}
          >
            <span>Tournament</span>
            <span>Buy-in</span>
            <span>Chips</span>
            <span>Blinds</span>
            <span>Prize pool</span>
            <span>Players</span>
            <span>Status</span>
            <span></span>
          </div>

          {/* Rows */}
          {loading ? (
            <div className="px-5 py-16 text-center font-mono text-sm animate-pulse" style={{ color: 'rgba(255,255,255,0.25)' }}>
              Loading tournaments...
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-16 text-center" style={{ color: 'rgba(255,255,255,0.25)' }}>
              <div className="font-display text-3xl mb-2">No tournaments</div>
              <div className="font-ui text-sm">Try a different buy-in filter</div>
            </div>
          ) : (
            filtered.map((t, i) => (
              <TournamentGridRow
                key={t.id}
                t={t}
                i={i}
                onJoin={() => { setJoinTarget(t); setJoinResult(null) }}
              />
            ))
          )}
        </div>

        {/* Join modal */}
        {joinTarget && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center px-4"
            style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(12px)' }}
            onClick={(e) => { if (e.target === e.currentTarget) { setJoinTarget(null); setJoinResult(null); setJoinEntries([]); setCountdown(null) } }}
          >
            <div
              className="w-full max-w-lg rounded-2xl p-6"
              style={{ background: 'rgba(10,10,15,0.98)', border: '1px solid rgba(34,211,238,0.2)' }}
            >
              <div className="flex items-start justify-between mb-5">
                <div>
                  <div className="font-display text-2xl font-medium" style={{ color: 'rgba(255,255,255,0.95)' }}>
                    Join {joinTarget.name}
                  </div>
                  <div className="font-mono text-xs mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    {joinTarget.id}
                  </div>
                </div>
                <button onClick={() => { setJoinTarget(null); setJoinResult(null); setJoinEntries([]); setCountdown(null) }} style={{ color: 'rgba(255,255,255,0.3)', cursor: 'pointer', background: 'none', border: 'none', fontSize: 20 }}>×</button>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  { label: 'Buy-in', value: joinTarget.is_free ? 'FREE' : `$${joinTarget.buy_in}`, color: joinTarget.is_free ? '#22d3ee' : '#fbbf24' },
                  { label: 'Starting chips', value: formatChips(joinTarget.starting_chips ?? 1500), color: 'rgba(255,255,255,0.8)' },
                  { label: 'Est. prize', value: getPrize(joinTarget), color: '#10b981' },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl p-3 text-center" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <div className="font-mono text-base font-semibold" style={{ color: s.color }}>{s.value}</div>
                    <div className="font-ui text-[10px] tracking-widest uppercase mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Balance */}
              {isConnected && !joinTarget.is_free && balance !== null && (
                <div
                  className="rounded-xl px-4 py-3 mb-4 flex items-center justify-between"
                  style={{
                    background: balance >= joinTarget.buy_in ? 'rgba(16,185,129,0.07)' : 'rgba(244,63,94,0.07)',
                    border: `1px solid ${balance >= joinTarget.buy_in ? 'rgba(16,185,129,0.2)' : 'rgba(244,63,94,0.2)'}`,
                  }}
                >
                  <span className="font-ui text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>Your balance</span>
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-semibold" style={{ color: balance >= joinTarget.buy_in ? '#10b981' : '#f43f5e' }}>
                      ${balance.toFixed(2)} USDC
                    </span>
                    {balance < joinTarget.buy_in && (
                      <a href="/dashboard" className="font-ui text-xs px-3 py-1 rounded-lg" style={{ background: 'rgba(34,211,238,0.15)', color: '#22d3ee', textDecoration: 'none' }}>
                        Top up →
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Not connected */}
              {!isConnected && (
                <div className="rounded-xl px-4 py-3 mb-4 text-center" style={{ background: 'rgba(34,211,238,0.05)', border: '1px solid rgba(34,211,238,0.15)' }}>
                  <button onClick={connectWallet} className="glass-button btn-cyan px-5 py-2 rounded-xl text-sm font-ui font-semibold" style={{ cursor: 'pointer' }}>
                    Connect Wallet to Join
                  </button>
                </div>
              )}

              {/* Registered agents list */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-[10px] tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    Registered agents
                  </span>
                  {countdown !== null ? (
                    <span className="font-mono text-xs font-bold animate-pulse" style={{ color: '#fbbf24' }}>
                      ⚡ Starting in {countdown}s
                    </span>
                  ) : (
                    <span className="font-mono text-[10px]" style={{ color: joinEntries.length >= joinTarget.max_players ? '#10b981' : '#22d3ee' }}>
                      {joinEntries.length}/{joinTarget.max_players} — {joinEntries.length >= joinTarget.max_players ? '🟢 Table full!' : `waiting for ${joinTarget.max_players - joinEntries.length} more`}
                    </span>
                  )}
                </div>
                <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(0,0,0,0.3)' }}>
                  {joinTarget.max_players > 0 && Array.from({ length: joinTarget.max_players }).map((_, idx) => {
                    const entry = joinEntries[idx]
                    const isBot = entry?.agents?.agent_type === 'bot_demo'
                    const isMyBot = !!(entry && joinResult?.agentName && entry.agents?.name === joinResult.agentName)
                    // Display name: for real users prefer display_name, else truncated wallet
                    const displayName = entry
                      ? isBot
                        ? (entry.agents?.name ?? entry.agent_id.slice(0, 8))
                        : (entry.users?.display_name || entry.agents?.name || (entry.users?.wallet_address?.slice(0, 6) + '…' + entry.users?.wallet_address?.slice(-4)) || entry.agent_id.slice(0, 8))
                      : null
                    return (
                      <div
                        key={idx}
                        className="flex items-center gap-3 px-4 py-2.5"
                        style={{
                          borderBottom: idx < joinTarget.max_players - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                          background: isMyBot ? 'rgba(34,211,238,0.06)' : 'transparent',
                        }}
                      >
                        <span className="font-mono text-[10px] w-4" style={{ color: 'rgba(255,255,255,0.2)' }}>{idx + 1}</span>
                        {entry ? (
                          <>
                            <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0"
                              style={{ background: isBot ? 'rgba(255,165,0,0.15)' : 'rgba(34,211,238,0.15)', border: `1px solid ${isBot ? 'rgba(255,165,0,0.3)' : 'rgba(34,211,238,0.3)'}` }}>
                              {isBot ? '🤖' : '👤'}
                            </span>
                            <span className="font-mono text-xs flex-1" style={{ color: isMyBot ? '#22d3ee' : 'rgba(255,255,255,0.7)' }}>
                              {displayName}
                            </span>
                            {isMyBot && <span className="font-mono text-[10px] px-2 py-0.5 rounded" style={{ background: 'rgba(34,211,238,0.15)', color: '#22d3ee' }}>YOU</span>}
                          </>
                        ) : (
                          <>
                            <span className="w-6 h-6 rounded-full shrink-0" style={{ background: 'rgba(255,255,255,0.04)', border: '1px dashed rgba(255,255,255,0.1)' }} />
                            <span className="font-mono text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>Empty seat</span>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {joinResult && !joinResult.ok && (
                <div
                  className="rounded-xl px-4 py-3 font-mono text-xs mb-4"
                  style={{ background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)', color: '#f43f5e' }}
                >
                  {joinResult.msg}
                </div>
              )}

              {countdown !== null && (
                <div
                  className="w-full rounded-xl mb-3 flex flex-col items-center justify-center py-4 gap-1"
                  style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)' }}
                >
                  <div className="font-mono text-4xl font-bold" style={{ color: '#fbbf24', lineHeight: 1 }}>{countdown}</div>
                  <div className="font-mono text-xs" style={{ color: 'rgba(251,191,36,0.7)' }}>seconds until start</div>
                </div>
              )}

              {(joinResult?.ok || countdown !== null) && (
                <button
                  onClick={() => window.open(`/table/${joinTarget.id}/1`, `table-${joinTarget.id}`, 'popup,width=1280,height=820,resizable=yes')}
                  className="w-full py-3.5 rounded-xl font-ui font-bold text-base mb-3 flex items-center justify-center gap-2.5 transition-all"
                  style={{
                    background: countdown !== null
                      ? 'linear-gradient(135deg, rgba(251,191,36,0.25) 0%, rgba(251,191,36,0.15) 100%)'
                      : 'linear-gradient(135deg, rgba(16,185,129,0.25) 0%, rgba(16,185,129,0.15) 100%)',
                    border: `1px solid ${countdown !== null ? 'rgba(251,191,36,0.5)' : 'rgba(16,185,129,0.5)'}`,
                    color: countdown !== null ? '#fbbf24' : '#10b981',
                    cursor: 'pointer',
                    boxShadow: countdown !== null ? '0 0 24px rgba(251,191,36,0.15)' : '0 0 24px rgba(16,185,129,0.15)',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                  </svg>
                  {countdown !== null ? 'Watch Table (Starting Soon)' : 'Watch Table Live'}
                </button>
              )}

              {isConnected && !joinResult?.ok && (
                <button
                  onClick={handleJoin}
                  disabled={joining || (!joinTarget.is_free && balance !== null && balance < joinTarget.buy_in)}
                  className="w-full glass-button btn-cyan py-3 rounded-xl font-ui font-semibold text-sm"
                  style={{
                    cursor: joining ? 'wait' : 'pointer',
                    opacity: (!joinTarget.is_free && balance !== null && balance < joinTarget.buy_in) ? 0.4 : 1,
                  }}
                >
                  {joining ? 'Confirm in MetaMask...' : joinTarget.is_free ? 'Join Free Tournament' : `Pay $${joinTarget.buy_in} & Join`}
                </button>
              )}

              <div className="mt-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="font-mono text-[10px] tracking-widest uppercase mb-2" style={{ color: 'rgba(255,255,255,0.25)' }}>
                  Or let your bot join programmatically:
                </div>
                <pre className="font-mono text-xs rounded-xl p-3 overflow-x-auto" style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}>
{`curl -X POST ${API_URL}/api/tournaments/${joinTarget.id}/join \\
  -H "Authorization: Bearer YOUR_API_KEY"`}
                </pre>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 rounded-xl text-sm font-mono font-medium transition-all duration-150"
      style={active ? {
        background: 'rgba(34,211,238,0.12)',
        border: '1px solid rgba(34,211,238,0.3)',
        color: '#22d3ee',
        cursor: 'pointer',
      } : {
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
        color: 'rgba(255,255,255,0.4)',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

function TournamentGridRow({ t, i, onJoin }: { t: Tournament; i: number; onJoin: () => void }) {
  const fill = t.max_players > 0 ? (t.current_players / t.max_players) * 100 : 0
  const badge = STATUS_BADGE[t.status] ?? STATUS_BADGE.registering
  const isRunning = t.status === 'running'

  return (
    <div
      className="grid items-center px-5 py-4 transition-all duration-150 hover:bg-white/[0.02]"
      style={{
        gridTemplateColumns: '2fr 90px 90px 90px 100px 100px 120px 120px',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        animationDelay: `${i * 0.03}s`,
      }}
    >
      {/* Name */}
      <div>
        <div className="font-display text-base font-medium" style={{ color: 'rgba(255,255,255,0.88)' }}>{t.name}</div>
        <div className="font-mono text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.22)' }}>
          {t.type === 'sit_n_go' ? 'Sit & Go' : t.type === 'heads_up' ? 'Heads Up' : 'MTT'}
        </div>
      </div>

      {/* Buy-in */}
      <div className="font-mono text-sm font-semibold" style={{ color: t.is_free ? '#22d3ee' : '#fbbf24' }}>
        {t.is_free ? 'FREE' : `$${t.buy_in}`}
      </div>

      {/* Starting chips */}
      <div className="font-mono text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
        {formatChips(t.starting_chips ?? 1500)}
      </div>

      {/* Blinds */}
      <div className="font-mono text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
        {getBlinds(t)}
      </div>

      {/* Prize pool */}
      <div className="font-mono text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
        {getPrize(t)}
      </div>

      {/* Players */}
      <div className="flex items-center gap-2">
        <div className="flex-1 max-w-[50px] h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${fill}%`,
              background: fill >= 80 ? '#10b981' : fill >= 50 ? '#22d3ee' : 'rgba(255,255,255,0.25)',
            }}
          />
        </div>
        <span className="font-mono text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {t.current_players}/{t.max_players}
        </span>
      </div>

      {/* Status badge */}
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: badge.dot, boxShadow: isRunning ? `0 0 6px ${badge.dot}` : 'none' }} />
        <span className="font-mono text-xs" style={{ color: badge.color }}>{badge.label}</span>
      </div>

      {/* Action */}
      <div>
        {isRunning ? (
          <button
            onClick={() => window.open(`/table/${t.id}/1`, `table-${t.id}`, 'popup,width=1280,height=820,resizable=yes')}
            className="glass-button flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-ui font-semibold"
            style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.45)', color: '#10b981', cursor: 'pointer', boxShadow: '0 0 10px rgba(16,185,129,0.12)' }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            Watch
          </button>
        ) : t.status === 'registering' ? (
          <button
            onClick={onJoin}
            className="glass-button btn-cyan px-4 py-1.5 rounded-xl text-xs font-ui font-semibold"
            style={{ cursor: 'pointer' }}
          >
            Join
          </button>
        ) : null}
      </div>
    </div>
  )
}
