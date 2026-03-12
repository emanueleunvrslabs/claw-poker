'use client'
import { useState, useEffect } from 'react'
import { useMetaMask } from '@/lib/useMetaMask'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3010'

// ── Types ─────────────────────────────────────────────────────────────────────
interface SportEvent {
  id: string
  sport: string
  league: string
  home: string
  away: string
  time: string
  odds: { home: number; draw: number; away: number }
}

interface AgentSportSettings {
  agent_id: string
  auto_sport_bet: boolean
  auto_sport_max_stake: number
  auto_sport_strategy: 'value' | 'safe' | 'aggressive'
}

interface AgentInfo {
  id: string
  name: string
}

interface SportBet {
  id: string
  event_name: string
  sport: string
  selection_label: string
  odds: number
  stake: number
  potential_win: number
  status: 'pending' | 'won' | 'lost' | 'void'
  placed_at: string
  settled_at?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const SPORT_ICONS: Record<string, string> = {
  football: '⚽',
  basketball: '🏀',
  tennis: '🎾',
  nfl: '🏈',
}
const SPORT_LABELS: Record<string, string> = {
  football: 'Football',
  basketball: 'Basketball',
  tennis: 'Tennis',
  nfl: 'NFL',
}

function formatEventTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diffH = Math.round((d.getTime() - now.getTime()) / 3600000)
  if (diffH < 1) return 'Soon'
  if (diffH < 24) return `Today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  if (diffH < 48) return `Tomorrow ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function SportPage() {
  const { address, isConnected } = useMetaMask()
  const [events, setEvents] = useState<SportEvent[]>([])
  const [sportFilter, setSportFilter] = useState<string>('football')
  const [agent, setAgent] = useState<AgentInfo | null>(null)
  const [settings, setSettings] = useState<AgentSportSettings | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [myBets, setMyBets] = useState<SportBet[]>([])
  const [betsTab, setBetsTab] = useState<'pending' | 'settled'>('pending')

  // Load events
  useEffect(() => {
    fetch(`${API_URL}/api/sport/events`)
      .then((r) => r.json())
      .then(setEvents)
      .catch(() => {})
  }, [])

  // Load agent + settings from wallet
  useEffect(() => {
    if (!address) { setAgent(null); setSettings(null); setMyBets([]); return }
    fetch(`${API_URL}/api/sport/wallet/${address}/settings`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) { setAgent(data.agent); setSettings(data.settings) }
      })
      .catch(() => {})
  }, [address])

  // Load agent bets
  useEffect(() => {
    if (!address) { setMyBets([]); return }
    fetch(`${API_URL}/api/sport/wallet/${address}/bets`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: SportBet[]) => setMyBets(data.sort((a, b) => new Date(b.placed_at).getTime() - new Date(a.placed_at).getTime())))
      .catch(() => {})
  }, [address])

  const sports = [...new Set(events.map((e) => e.sport))]
  const filtered = events.filter((e) => e.sport === sportFilter)

  async function saveSettings(patch: Partial<AgentSportSettings>) {
    if (!address || !settings) return
    setSavingSettings(true)
    const eth = (window as any).ethereum
    if (!eth) { setSavingSettings(false); return }
    try {
      const timestamp = Math.floor(Date.now() / 1000)
      const message = `Update sport settings\nWallet: ${address.toLowerCase()}\nTimestamp: ${timestamp}`
      let signature: string
      try {
        signature = await eth.request({ method: 'personal_sign', params: [message, address] })
      } catch { setSavingSettings(false); return }
      const res = await fetch(`${API_URL}/api/sport/wallet/${address}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...patch, signature, timestamp }),
      })
      if (res.ok) {
        const data = await res.json()
        setSettings(data.settings)
      }
    } catch {}
    setSavingSettings(false)
  }

  return (
    <div className="px-6 py-8 pt-24" style={{ maxWidth: 1200, margin: '0 auto' }}>

      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <h1 className="font-display text-3xl font-bold" style={{ color: 'rgba(255,255,255,0.95)', marginBottom: 6 }}>
          Sports <span style={{ color: '#e63946' }}>Betting</span>
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>
          Your AI agent analyzes odds and places bets autonomously.
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
          <span>Connect your wallet to enable Autonomous Mode.</span>
        </div>
      ) : !agent ? (
        <div style={{
          background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.12)',
          borderRadius: 14, padding: '16px 22px', marginBottom: 28,
          color: 'rgba(251,191,36,0.7)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span>⚡</span>
          <span>No agent found for this wallet. Register your agent in the <a href="/dashboard" style={{ color: '#fbbf24', textDecoration: 'underline' }}>Dashboard</a> first.</span>
        </div>
      ) : settings ? (
        <div
          style={{
            background: settings.auto_sport_bet
              ? 'linear-gradient(135deg, rgba(16,185,129,0.12), rgba(16,185,129,0.06))'
              : 'rgba(255,255,255,0.04)',
            border: `1px solid ${settings.auto_sport_bet ? 'rgba(16,185,129,0.35)' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: 14,
            padding: '18px 22px',
            marginBottom: 28,
            transition: 'all 0.3s ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 18,
                  background: settings.auto_sport_bet ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.07)',
                  border: `1px solid ${settings.auto_sport_bet ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.1)'}`,
                }}
              >
                ⚡
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: 'rgba(255,255,255,0.9)' }}>
                    AUTONOMOUS MODE
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
                    background: settings.auto_sport_bet ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.07)',
                    color: settings.auto_sport_bet ? '#10b981' : 'rgba(255,255,255,0.4)',
                    border: `1px solid ${settings.auto_sport_bet ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.1)'}`,
                  }}>
                    {settings.auto_sport_bet ? '● ACTIVE' : '○ OFF'}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
                  Agent: <span style={{ color: 'rgba(255,255,255,0.75)' }}>{agent.name}</span>
                  {settings.auto_sport_bet && (
                    <span> · Betting up to <span style={{ color: '#fbbf24' }}>${settings.auto_sport_max_stake}</span> per event · every 5 minutes</span>
                  )}
                </div>
              </div>
            </div>
            {/* Toggle */}
            <button
              onClick={() => saveSettings({ auto_sport_bet: !settings.auto_sport_bet })}
              disabled={savingSettings}
              style={{
                width: 52, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer',
                background: settings.auto_sport_bet
                  ? 'linear-gradient(135deg, #10b981, #059669)'
                  : 'rgba(255,255,255,0.12)',
                position: 'relative', transition: 'all 0.25s ease',
                boxShadow: settings.auto_sport_bet ? '0 0 12px rgba(16,185,129,0.4)' : 'none',
                flexShrink: 0,
                opacity: savingSettings ? 0.6 : 1,
              }}
            >
              <div style={{
                width: 20, height: 20, borderRadius: '50%', background: '#fff',
                position: 'absolute', top: 4,
                left: settings.auto_sport_bet ? 'calc(100% - 24px)' : 4,
                transition: 'left 0.25s ease',
                boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
              }} />
            </button>
          </div>

          {/* Settings row (when active) */}
          {settings.auto_sport_bet && (
            <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
              <div>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 5 }}>
                  MAX STAKE PER BET ($)
                </label>
                <input
                  type="number"
                  min={1}
                  value={settings.auto_sport_max_stake}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    if (v > 0) setSettings({ ...settings, auto_sport_max_stake: v })
                  }}
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value)
                    if (v > 0) saveSettings({ auto_sport_max_stake: v })
                  }}
                  style={{
                    width: 90, padding: '6px 10px', borderRadius: 8, fontSize: 14, fontWeight: 600,
                    background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
                    color: 'rgba(255,255,255,0.9)', outline: 'none',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', display: 'block', marginBottom: 5 }}>
                  STRATEGY
                </label>
                <select
                  value={settings.auto_sport_strategy}
                  onChange={(e) => {
                    const v = e.target.value as AgentSportSettings['auto_sport_strategy']
                    setSettings({ ...settings, auto_sport_strategy: v })
                    saveSettings({ auto_sport_strategy: v })
                  }}
                  style={{
                    padding: '6px 10px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                    background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
                    color: 'rgba(255,255,255,0.9)', outline: 'none', cursor: 'pointer',
                  }}
                >
                  <option value="value">💎 Value (odds &gt; 2.5)</option>
                  <option value="safe">🛡 Safe (odds 1.3–1.8)</option>
                  <option value="aggressive">🔥 Aggressive (odds &gt; 4.0)</option>
                </select>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* Sport tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {sports.map((s) => (
          <button
            key={s}
            onClick={() => setSportFilter(s)}
            style={{
              padding: '8px 16px', borderRadius: 999, border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 600, transition: 'all 0.2s ease',
              background: sportFilter === s ? '#e63946' : 'rgba(255,255,255,0.06)',
              color: sportFilter === s ? '#fff' : 'rgba(255,255,255,0.55)',
              boxShadow: sportFilter === s ? '0 0 14px rgba(230,57,70,0.35)' : 'none',
            }}
          >
            {SPORT_ICONS[s]} {SPORT_LABELS[s] ?? s}
          </button>
        ))}
      </div>

      {/* Events — full width, read-only odds */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 40 }}>
        {filtered.map((ev) => (
          <div
            key={ev.id}
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 12, padding: '16px 18px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>
                  {ev.home} <span style={{ color: 'rgba(255,255,255,0.3)', fontWeight: 400 }}>vs</span> {ev.away}
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 3 }}>{ev.league}</div>
              </div>
              <div style={{
                fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)',
                background: 'rgba(255,255,255,0.06)', borderRadius: 6, padding: '3px 8px', whiteSpace: 'nowrap',
              }}>
                {formatEventTime(ev.time)}
              </div>
            </div>

            {/* Odds — display only */}
            <div style={{ display: 'flex', gap: 8 }}>
              {(['home', 'draw', 'away'] as const).map((sel) => {
                const odds = ev.odds[sel]
                if (!odds) return null
                const label = sel === 'home' ? ev.home : sel === 'away' ? ev.away : 'Draw'
                return (
                  <div
                    key={sel}
                    style={{
                      flex: 1, padding: '10px 8px', borderRadius: 9, textAlign: 'center',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginBottom: 3 }}>
                      {label.length > 12 ? label.slice(0, 10) + '…' : label}
                    </div>
                    <div style={{
                      fontSize: 16, fontWeight: 800, fontFamily: 'JetBrains Mono, monospace',
                      color: 'rgba(255,255,255,0.8)',
                    }}>
                      {odds.toFixed(2)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Agent Bets section */}
      {address && (
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.9)', marginBottom: 16 }}>
            Agent Bets
          </h2>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.07)', paddingBottom: 0 }}>
            {([['pending', 'Active'], ['settled', 'Settled']] as const).map(([tab, label]) => {
              const count = tab === 'pending'
                ? myBets.filter(b => b.status === 'pending').length
                : myBets.filter(b => b.status !== 'pending').length
              return (
                <button
                  key={tab}
                  onClick={() => setBetsTab(tab)}
                  style={{
                    padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 13, fontWeight: 600, transition: 'all 0.2s ease',
                    color: betsTab === tab ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)',
                    borderBottom: `2px solid ${betsTab === tab ? '#e63946' : 'transparent'}`,
                    marginBottom: -1,
                  }}
                >
                  {label}
                  {count > 0 && (
                    <span style={{
                      marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
                      background: betsTab === tab ? '#e63946' : 'rgba(255,255,255,0.08)',
                      color: betsTab === tab ? '#fff' : 'rgba(255,255,255,0.4)',
                    }}>{count}</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Bets list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {myBets
              .filter(b => betsTab === 'pending' ? b.status === 'pending' : b.status !== 'pending')
              .map(bet => {
                const statusColor = bet.status === 'won' ? '#10b981' : bet.status === 'lost' ? '#e63946' : bet.status === 'void' ? '#fbbf24' : 'rgba(255,255,255,0.4)'
                const statusBg = bet.status === 'won' ? 'rgba(16,185,129,0.12)' : bet.status === 'lost' ? 'rgba(230,57,70,0.12)' : bet.status === 'void' ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.06)'
                const statusLabel = bet.status === 'won' ? 'WON' : bet.status === 'lost' ? 'LOST' : bet.status === 'void' ? 'VOID' : 'PENDING'
                return (
                  <div key={bet.id} style={{
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
                    borderRadius: 12, padding: '14px 18px',
                    display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center',
                  }}>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: 16 }}>{SPORT_ICONS[bet.sport] ?? '🎯'}</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>
                          {bet.event_name}
                        </div>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                          {bet.selection_label} · <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>@{bet.odds.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Stake</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.75)', fontFamily: 'JetBrains Mono, monospace' }}>
                          ${bet.stake.toFixed(2)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>Potential</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#10b981', fontFamily: 'JetBrains Mono, monospace' }}>
                          ${bet.potential_win.toFixed(2)}
                        </div>
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 800, padding: '4px 10px', borderRadius: 999,
                        background: statusBg, color: statusColor, letterSpacing: '0.05em',
                      }}>{statusLabel}</span>
                    </div>
                  </div>
                )
              })
            }
            {myBets.filter(b => betsTab === 'pending' ? b.status === 'pending' : b.status !== 'pending').length === 0 && (
              <div style={{ textAlign: 'center', padding: '32px 0', color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>
                {betsTab === 'pending' ? 'No active bets — enable autonomous mode to start' : 'No settled bets yet'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
