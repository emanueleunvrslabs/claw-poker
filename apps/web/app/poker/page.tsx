'use client'
import { useState, useEffect, useCallback } from 'react'
import { useMetaMask } from '@/lib/useMetaMask'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3010'

interface AgentPokerSettings {
  agent_id: string
  auto_poker: boolean
  auto_poker_max_buyin: number
}

interface AgentInfo {
  id: string
  name: string
}

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

interface TournamentEntry {
  agent_id: string
  registered_by?: string
  chips?: number
  stack?: number
  agents?: { name: string; agent_type: string }
  users?: { display_name: string | null; wallet_address: string }
}

const BUY_IN_TABS = [0, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]

function formatBuyIn(v: number) {
  if (v === 0) return 'Free'
  if (v >= 1000) return `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K`
  return `$${v}`
}

function formatChips(n: number) {
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return `${m % 1 === 0 ? m : m.toFixed(1)}M`
  }
  if (n >= 1000) {
    const k = n / 1000
    return `${k % 1 === 0 ? k : k.toFixed(1)}K`
  }
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
  registering: { label: 'Open', color: '#10b981', dot: '#10b981' },
  running:     { label: 'Running', color: '#10b981', dot: '#10b981' },
  finished:    { label: 'Ended', color: 'rgba(255,255,255,0.3)', dot: 'rgba(255,255,255,0.2)' },
  cancelled:   { label: 'Cancelled', color: '#f43f5e', dot: '#f43f5e' },
}

export default function LobbyPage() {
  const { address, isConnected } = useMetaMask()
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<number | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'registering' | 'running' | 'agent'>('all')
  const [agentTournamentIds, setAgentTournamentIds] = useState<Set<string>>(new Set())
  const [detailTarget, setDetailTarget] = useState<Tournament | null>(null)
  const [detailEntries, setDetailEntries] = useState<TournamentEntry[]>([])
  const [pokerAgent, setPokerAgent] = useState<AgentInfo | null>(null)
  const [pokerSettings, setPokerSettings] = useState<AgentPokerSettings | null>(null)
  const [savingPoker, setSavingPoker] = useState(false)

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

  // Load poker agent + settings from wallet
  useEffect(() => {
    if (!address) { setPokerAgent(null); setPokerSettings(null); return }
    fetch(`${API_URL}/api/poker/wallet/${address}/settings`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) { setPokerAgent(data.agent); setPokerSettings(data.settings) } })
      .catch(() => {})
  }, [address])

  // Load agent's enrolled tournaments (poll every 10s)
  useEffect(() => {
    if (!pokerAgent) { setAgentTournamentIds(new Set()); return }
    const fetchAgentTournaments = () => {
      fetch(`${API_URL}/api/tournaments/by-agent/${pokerAgent.id}`)
        .then(r => r.ok ? r.json() : [])
        .then((data: { id: string }[]) => setAgentTournamentIds(new Set(Array.isArray(data) ? data.map(t => t.id) : [])))
        .catch(() => {})
    }
    fetchAgentTournaments()
    const iv = setInterval(fetchAgentTournaments, 10000)
    return () => clearInterval(iv)
  }, [pokerAgent])

  async function savePokerSettings(patch: Partial<AgentPokerSettings>) {
    if (!address || !pokerSettings) return
    setSavingPoker(true)
    try {
      const res = await fetch(`${API_URL}/api/poker/wallet/${address}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (res.ok) {
        const data = await res.json()
        setPokerSettings(data.settings)
      }
    } catch {}
    setSavingPoker(false)
  }

  // Fetch entries for details modal, enrich with live chip counts, poll every 5s
  useEffect(() => {
    if (!detailTarget) { setDetailEntries([]); return }
    const fetchDetail = async () => {
      try {
        const [baseRes, liveRes] = await Promise.all([
          fetch(`${API_URL}/api/tournaments/${detailTarget.id}`),
          fetch(`${API_URL}/api/tournaments/${detailTarget.id}/live`),
        ])
        const base = baseRes.ok ? await baseRes.json() : null
        const live = liveRes.ok ? await liveRes.json() : null
        const entries: TournamentEntry[] = base?.entries ?? []
        if (live?.players?.length) {
          const chipMap = new Map<string, number>()
          for (const p of live.players) chipMap.set(p.agent_id, p.chips)
          for (const e of entries) {
            const c = chipMap.get(e.agent_id)
            if (c !== undefined) e.chips = c
          }
        }
        setDetailEntries(entries)
      } catch {}
    }
    fetchDetail()
    const iv = setInterval(fetchDetail, 5000)
    return () => clearInterval(iv)
  }, [detailTarget])

  const filtered = tournaments.filter((t) => {
    if (t.status === 'cancelled' || t.status === 'finished') return false
    if (statusFilter === 'agent') return agentTournamentIds.has(t.id)
    if (statusFilter !== 'all' && t.status !== statusFilter) return false
    if (activeTab === 'all') return true
    if (activeTab === 0) return t.is_free
    return !t.is_free && t.buy_in === activeTab
  })

  const running = tournaments.filter((t) => t.status === 'running').length
  const open = tournaments.filter((t) => t.status === 'registering').length

  return (
    <div className="min-h-screen pt-28 pb-16 px-6">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold" style={{ color: 'rgba(255,255,255,0.95)', marginBottom: 6 }}>
            Tournament <span style={{ color: '#e63946' }}>Lobby</span>
          </h1>
          <p className="font-ui text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {running} running · {open} open
          </p>
        </div>

        {/* Autonomous Mode card */}
        {!isConnected ? (
          <div style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 14, padding: '16px 22px', marginBottom: 28,
            color: 'rgba(255,255,255,0.35)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 16 }}>👛</span>
            <span>Connect your wallet to enable Autonomous Poker Mode.</span>
          </div>
        ) : !pokerAgent ? (
          <div style={{
            background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.12)',
            borderRadius: 14, padding: '16px 22px', marginBottom: 28,
            color: 'rgba(251,191,36,0.7)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span>⚡</span>
            <span>No agent found for this wallet. Register your agent in the <a href="/dashboard" style={{ color: '#fbbf24', textDecoration: 'underline' }}>Dashboard</a> first.</span>
          </div>
        ) : pokerSettings ? (
          <div style={{
            background: pokerSettings.auto_poker
              ? 'linear-gradient(135deg, rgba(16,185,129,0.12), rgba(16,185,129,0.06))'
              : 'rgba(255,255,255,0.04)',
            border: `1px solid ${pokerSettings.auto_poker ? 'rgba(16,185,129,0.35)' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: 14, padding: '18px 22px', marginBottom: 28,
            transition: 'all 0.3s ease',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 18,
                  background: pokerSettings.auto_poker ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.07)',
                  border: `1px solid ${pokerSettings.auto_poker ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.1)'}`,
                }}>
                  ♠️
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: 'rgba(255,255,255,0.9)' }}>
                      AUTONOMOUS MODE
                    </span>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
                      background: pokerSettings.auto_poker ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.07)',
                      color: pokerSettings.auto_poker ? '#10b981' : 'rgba(255,255,255,0.4)',
                      border: `1px solid ${pokerSettings.auto_poker ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.1)'}`,
                    }}>
                      {pokerSettings.auto_poker ? '● ACTIVE' : '○ OFF'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
                    Agent: <span style={{ color: 'rgba(255,255,255,0.75)' }}>{pokerAgent.name}</span>
                    {pokerSettings.auto_poker && (
                      <span> · Joining tournaments up to <span style={{ color: '#fbbf24' }}>${pokerSettings.auto_poker_max_buyin}</span> buy-in</span>
                    )}
                  </div>
                </div>
              </div>
              {/* Toggle */}
              <button
                onClick={() => savePokerSettings({ auto_poker: !pokerSettings.auto_poker })}
                disabled={savingPoker}
                style={{
                  width: 52, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer',
                  background: pokerSettings.auto_poker
                    ? 'linear-gradient(135deg, #10b981, #059669)'
                    : 'rgba(255,255,255,0.12)',
                  position: 'relative', transition: 'all 0.25s ease',
                  boxShadow: pokerSettings.auto_poker ? '0 0 12px rgba(16,185,129,0.4)' : 'none',
                  flexShrink: 0,
                }}
              >
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', background: '#fff',
                  position: 'absolute', top: 4,
                  left: pokerSettings.auto_poker ? 'calc(100% - 24px)' : 4,
                  transition: 'left 0.25s ease',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                }} />
              </button>
            </div>

            {/* Max buy-in setting (when active) */}
            {pokerSettings.auto_poker && (
              <div style={{ marginTop: 16 }}>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 5 }}>
                  MAX BUY-IN ($)
                </label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[0, 5, 10, 25, 50, 100].map((v) => (
                    <button
                      key={v}
                      onClick={() => savePokerSettings({ auto_poker_max_buyin: v === 0 ? 999999 : v })}
                      style={{
                        padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
                        fontSize: 13, fontWeight: 600, transition: 'all 0.15s ease',
                        background: (v === 0 ? pokerSettings.auto_poker_max_buyin >= 999 : pokerSettings.auto_poker_max_buyin === v)
                          ? 'rgba(16,185,129,0.25)'
                          : 'rgba(255,255,255,0.07)',
                        color: (v === 0 ? pokerSettings.auto_poker_max_buyin >= 999 : pokerSettings.auto_poker_max_buyin === v)
                          ? '#10b981'
                          : 'rgba(255,255,255,0.55)',
                        border: `1px solid ${(v === 0 ? pokerSettings.auto_poker_max_buyin >= 999 : pokerSettings.auto_poker_max_buyin === v) ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.1)'}`,
                      }}
                    >
                      {v === 0 ? 'Free only' : `$${v}`}
                    </button>
                  ))}
                  <input
                    type="number" min={1}
                    value={pokerSettings.auto_poker_max_buyin >= 999999 ? '' : pokerSettings.auto_poker_max_buyin}
                    placeholder="Custom"
                    onChange={(e) => {
                      const v = parseFloat(e.target.value)
                      if (v > 0) setPokerSettings({ ...pokerSettings, auto_poker_max_buyin: v })
                    }}
                    onBlur={(e) => {
                      const v = parseFloat(e.target.value)
                      if (v > 0) savePokerSettings({ auto_poker_max_buyin: v })
                    }}
                    style={{
                      width: 80, padding: '6px 10px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                      background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
                      color: 'rgba(255,255,255,0.9)', outline: 'none',
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        ) : null}

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
            { key: 'registering', label: 'Open', dot: '#10b981' },
            { key: 'running',     label: 'Live', dot: '#10b981' },
          ] as const).map(({ key, label, dot }) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-mono font-medium transition-all duration-150"
              style={statusFilter === key ? {
                background: key === 'running' ? 'rgba(16,185,129,0.12)' : key === 'registering' ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.08)',
                border: `1px solid ${key === 'running' ? 'rgba(16,185,129,0.35)' : key === 'registering' ? 'rgba(16,185,129,0.35)' : 'rgba(255,255,255,0.2)'}`,
                color: key === 'running' ? '#10b981' : key === 'registering' ? '#10b981' : 'rgba(255,255,255,0.8)',
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

          {/* Agent filter — only if wallet connected and agent found */}
          {pokerAgent && (
            <button
              onClick={() => setStatusFilter(statusFilter === 'agent' ? 'all' : 'agent')}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-mono font-medium transition-all duration-150"
              style={statusFilter === 'agent' ? {
                background: 'rgba(230,57,70,0.12)',
                border: '1px solid rgba(230,57,70,0.35)',
                color: '#e63946',
                cursor: 'pointer',
              } : {
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
                color: 'rgba(255,255,255,0.35)',
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 10 }}>♠</span>
              {pokerAgent.name}
              <span className="ml-0.5 font-mono text-[10px]" style={{ color: 'inherit', opacity: 0.6 }}>
                {agentTournamentIds.size}
              </span>
            </button>
          )}
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
              gridTemplateColumns: '2fr 90px 90px 90px 100px 100px 120px 190px',
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
                onDetails={() => setDetailTarget(t)}
              />
            ))
          )}
        </div>

        {/* Details modal (running tournaments) */}
        {detailTarget && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center px-4"
            style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(12px)' }}
            onClick={(e) => { if (e.target === e.currentTarget) setDetailTarget(null) }}
          >
            <div
              className="w-full max-w-lg rounded-2xl p-6"
              style={{ background: 'rgba(10,10,15,0.98)', border: '1px solid rgba(16,185,129,0.2)' }}
            >
              <div className="flex items-start justify-between mb-5">
                <div>
                  <div className="flex items-center gap-2">
                    {detailTarget.status === 'running' && (
                      <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
                    )}
                    <div className="font-display text-2xl font-medium" style={{ color: 'rgba(255,255,255,0.95)' }}>
                      {detailTarget.name}
                    </div>
                  </div>
                  <div className="font-mono text-xs mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    {detailTarget.id}
                  </div>
                </div>
                <button onClick={() => setDetailTarget(null)} style={{ color: 'rgba(255,255,255,0.3)', cursor: 'pointer', background: 'none', border: 'none', fontSize: 20 }}>×</button>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  { label: 'Buy-in', value: detailTarget.is_free ? 'FREE' : `$${detailTarget.buy_in}`, color: detailTarget.is_free ? '#e63946' : '#fbbf24' },
                  { label: 'Starting chips', value: formatChips(detailTarget.starting_chips ?? 1500), color: 'rgba(255,255,255,0.8)' },
                  { label: 'Est. prize', value: getPrize(detailTarget), color: '#10b981' },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl p-3 text-center" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <div className="font-mono text-base font-semibold" style={{ color: s.color }}>{s.value}</div>
                    <div className="font-ui text-[10px] tracking-widest uppercase mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Agents + chips */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-[10px] tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    Agents in game
                  </span>
                  <span className="font-mono text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                    {detailEntries.length}/{detailTarget.max_players} players
                  </span>
                </div>
                <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(0,0,0,0.3)' }}>
                  {/* Header row */}
                  <div className="flex items-center gap-3 px-4 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
                    <span className="font-mono text-[9px] w-4" style={{ color: 'rgba(255,255,255,0.2)' }}>#</span>
                    <span className="w-6 shrink-0" />
                    <span className="font-mono text-[9px] tracking-widest uppercase flex-1" style={{ color: 'rgba(255,255,255,0.2)' }}>Agent</span>
                    <span className="font-mono text-[9px] tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.2)' }}>Chips</span>
                  </div>
                  {detailTarget.max_players > 0 && Array.from({ length: detailTarget.max_players }).map((_, idx) => {
                    const entry = detailEntries[idx]
                    const isBot = entry?.agents?.agent_type === 'bot_demo'
                    const displayName = entry
                      ? isBot
                        ? (entry.agents?.name ?? entry.agent_id.slice(0, 8))
                        : (entry.users?.display_name || entry.agents?.name || (entry.users?.wallet_address?.slice(0, 6) + '…' + entry.users?.wallet_address?.slice(-4)) || entry.agent_id.slice(0, 8))
                      : null
                    const chips = entry?.chips ?? entry?.stack ?? null
                    return (
                      <div
                        key={idx}
                        className="flex items-center gap-3 px-4 py-2.5"
                        style={{ borderBottom: idx < detailTarget.max_players - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}
                      >
                        <span className="font-mono text-[10px] w-4" style={{ color: 'rgba(255,255,255,0.2)' }}>{idx + 1}</span>
                        {entry ? (
                          <>
                            <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0"
                              style={{ background: isBot ? 'rgba(255,165,0,0.15)' : 'rgba(230,57,70,0.15)', border: `1px solid ${isBot ? 'rgba(255,165,0,0.3)' : 'rgba(230,57,70,0.3)'}` }}>
                              {isBot ? '🤖' : '👤'}
                            </span>
                            <span className="font-mono text-xs flex-1" style={{ color: 'rgba(255,255,255,0.7)' }}>
                              {displayName}
                            </span>
                            <span className="font-mono text-sm font-semibold" style={{ color: chips !== null ? '#10b981' : 'rgba(255,255,255,0.2)' }}>
                              {chips !== null ? formatChips(chips) : '—'}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="w-6 h-6 rounded-full shrink-0" style={{ background: 'rgba(255,255,255,0.04)', border: '1px dashed rgba(255,255,255,0.1)' }} />
                            <span className="font-mono text-xs flex-1" style={{ color: 'rgba(255,255,255,0.2)' }}>Empty seat</span>
                            <span className="font-mono text-sm" style={{ color: 'rgba(255,255,255,0.1)' }}>—</span>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Watch button — only when running */}
              {detailTarget.status === 'running' ? (
                <button
                  onClick={() => window.open(`/table/${detailTarget.id}/1`, `table-${detailTarget.id}`, 'popup,width=1280,height=820,resizable=yes')}
                  className="w-full py-3 rounded-xl font-ui font-semibold text-sm flex items-center justify-center gap-2"
                  style={{
                    background: 'rgba(16,185,129,0.12)',
                    border: '1px solid rgba(16,185,129,0.35)',
                    color: '#10b981',
                    cursor: 'pointer',
                    boxShadow: '0 0 20px rgba(16,185,129,0.1)',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                  </svg>
                  Watch Live
                </button>
              ) : (
                <div
                  className="w-full py-3 rounded-xl font-ui font-semibold text-sm flex items-center justify-center gap-2"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: 'rgba(255,255,255,0.3)',
                  }}
                >
                  Waiting for players to join...
                </div>
              )}
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
        background: 'rgba(230,57,70,0.12)',
        border: '1px solid rgba(230,57,70,0.3)',
        color: '#e63946',
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

function TournamentGridRow({ t, i, onDetails }: { t: Tournament; i: number; onDetails: () => void }) {
  const fill = t.max_players > 0 ? (t.current_players / t.max_players) * 100 : 0
  const badge = STATUS_BADGE[t.status] ?? STATUS_BADGE.registering
  const isRunning = t.status === 'running'

  return (
    <div
      className="grid items-center px-5 py-4 transition-all duration-150 hover:bg-white/[0.02]"
      style={{
        gridTemplateColumns: '2fr 90px 90px 90px 100px 100px 120px 190px',
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
      <div className="font-mono text-sm font-semibold" style={{ color: t.is_free ? '#e63946' : '#fbbf24' }}>
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
              background: fill >= 80 ? '#10b981' : fill >= 50 ? '#e63946' : 'rgba(255,255,255,0.25)',
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
      <div className="flex items-center gap-2">
        {(isRunning || t.status === 'registering') && (
          <button
            onClick={onDetails}
            className="glass-button flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-ui font-semibold transition-all duration-150"
            style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.35)', color: '#a5b4fc', cursor: 'pointer', boxShadow: '0 0 10px rgba(99,102,241,0.1)' }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            Dettagli
          </button>
        )}
        {isRunning && (
          <button
            onClick={() => window.open(`/table/${t.id}/1`, `table-${t.id}`, 'popup,width=1280,height=820,resizable=yes')}
            className="glass-button flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-ui font-semibold"
            style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.45)', color: '#10b981', cursor: 'pointer', boxShadow: '0 0 10px rgba(16,185,129,0.12)' }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            Watch
          </button>
        )}
      </div>
    </div>
  )
}
