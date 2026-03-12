'use client'
import { useState, useEffect } from 'react'
import { clsx } from 'clsx'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3333'

interface Tournament {
  id: string
  name: string
  type: string
  buy_in: number
  prize_pool: number
  current_players: number
  max_players: number
  status: string
  is_free: boolean
}

const STATUS_COLORS: Record<string, string> = {
  registering: '#22d3ee',
  running: '#10b981',
  finished: 'rgba(255,255,255,0.3)',
  cancelled: '#f43f5e',
}

const TYPE_LABELS: Record<string, string> = {
  sit_n_go: 'Sit & Go',
  heads_up: 'Heads Up',
  mtt: 'MTT',
}

export default function LobbyPage() {
  const [filter, setFilter] = useState<'all' | 'free' | 'paid'>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | 'sit_n_go' | 'heads_up' | 'mtt'>('all')
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API_URL}/api/tournaments?status=registering&limit=50`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setTournaments(Array.isArray(data) ? data : []))
      .catch(() => setTournaments([]))
      .finally(() => setLoading(false))
  }, [])

  const filtered = tournaments.filter((t) => {
    if (filter === 'free' && !t.is_free) return false
    if (filter === 'paid' && t.is_free) return false
    if (typeFilter !== 'all' && t.type !== typeFilter) return false
    return true
  })

  const running = tournaments.filter(t => t.status === 'running').length
  const registering = tournaments.filter(t => t.status === 'registering').length

  return (
    <div className="min-h-screen pt-28 pb-16 px-6">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="font-display text-6xl font-light mb-2" style={{ color: 'rgba(255,255,255,0.95)' }}>
            Tournament <span className="italic" style={{ color: '#22d3ee' }}>Lobby</span>
          </h1>
          <p className="font-ui text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>
            {running} running · {registering} open
          </p>
        </div>

        {/* Demo Live Banner */}
        <div
          className="rounded-2xl p-5 mb-8 flex items-center justify-between gap-4"
          style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.25)' }}
        >
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" style={{ boxShadow: '0 0 8px #10b981', animation: 'pulseGlow 1.5s ease-in-out infinite' }} />
              <span className="font-mono text-xs font-bold tracking-widest uppercase text-emerald-400">Live Demo</span>
            </div>
            <div>
              <div className="font-display text-lg font-medium" style={{ color: 'rgba(255,255,255,0.9)' }}>AI Agent Showdown</div>
              <div className="font-ui text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>6 AI bots · All cards visible · Continuous play</div>
            </div>
          </div>
          <button
            onClick={() => window.open('/table/demo-1/1', 'demo-table', 'popup,width=1280,height=820,resizable=yes')}
            className="glass-button shrink-0 px-5 py-2.5 rounded-xl text-sm font-ui font-semibold flex items-center gap-2"
            style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)', color: '#10b981', cursor: 'pointer' }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#10b981' }} />
            Watch Now
          </button>
        </div>

        <div className="flex gap-8">
          {/* Sidebar */}
          <aside className="w-48 shrink-0">
            <div className="glass-panel rounded-2xl p-4 sticky top-28">
              <FilterSection
                title="Buy-in"
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'free', label: 'Free' },
                  { value: 'paid', label: 'Paid' },
                ]}
                value={filter}
                onChange={(v) => setFilter(v as typeof filter)}
              />
              <div className="my-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} />
              <FilterSection
                title="Type"
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'sit_n_go', label: 'Sit & Go' },
                  { value: 'heads_up', label: 'Heads Up' },
                  { value: 'mtt', label: 'MTT' },
                ]}
                value={typeFilter}
                onChange={(v) => setTypeFilter(v as typeof typeFilter)}
              />
            </div>
          </aside>

          {/* Tournament list */}
          <div className="flex-1 space-y-3">
            {loading ? (
              <div className="glass-panel rounded-2xl p-12 text-center">
                <div className="font-mono text-sm animate-pulse" style={{ color: 'rgba(255,255,255,0.3)' }}>Loading tournaments...</div>
              </div>
            ) : filtered.length === 0 ? (
              <div className="glass-panel rounded-2xl p-12 text-center" style={{ color: 'rgba(255,255,255,0.3)' }}>
                <div className="font-display text-4xl mb-3">No tournaments</div>
                <div className="font-ui text-sm">Check back later or join the demo above</div>
              </div>
            ) : (
              filtered.map((t, i) => <TournamentRow key={t.id} tournament={t} index={i} />)
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function FilterSection({ title, options, value, onChange }: {
  title: string
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <div className="font-mono text-[10px] tracking-widest uppercase mb-3" style={{ color: 'rgba(255,255,255,0.3)' }}>{title}</div>
      <div className="space-y-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={clsx(
              'w-full text-left px-3 py-2 rounded-xl text-sm font-ui transition-all duration-150',
              value === opt.value ? 'bg-cyan-400/10 text-cyan-400' : 'text-white/40 hover:text-white/70 hover:bg-white/5'
            )}
            style={value === opt.value ? { border: '1px solid rgba(34,211,238,0.2)' } : { border: '1px solid transparent' }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function TournamentRow({ tournament: t, index }: { tournament: Tournament; index: number }) {
  const fillPct = (t.current_players / t.max_players) * 100
  const statusColor = STATUS_COLORS[t.status] ?? 'rgba(255,255,255,0.3)'
  const isRunning = t.status === 'running'

  return (
    <div className="glass-card rounded-2xl p-5 animate-fade-up" style={{ animationDelay: `${index * 0.05}s` }}>
      <div className="flex items-center gap-4">
        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: statusColor, boxShadow: `0 0 8px ${statusColor}`, animation: isRunning ? 'pulseGlow 1.5s ease-in-out infinite' : 'none' }} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <span className="font-display text-xl font-medium" style={{ color: 'rgba(255,255,255,0.9)' }}>{t.name}</span>
            <span className="font-mono text-[10px] tracking-wider uppercase px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)' }}>
              {TYPE_LABELS[t.type] ?? t.type}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-20 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${fillPct}%`, background: fillPct >= 80 ? '#10b981' : fillPct >= 50 ? '#22d3ee' : 'rgba(255,255,255,0.3)' }} />
              </div>
              <span className="font-mono text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{t.current_players}/{t.max_players}</span>
            </div>
            <span className="font-ui text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>1500 chips</span>
          </div>
        </div>

        <div className="text-right shrink-0">
          <div className="font-mono text-lg font-semibold" style={{ color: t.is_free ? '#22d3ee' : '#fbbf24' }}>
            {t.is_free ? 'FREE' : `$${t.buy_in}`}
          </div>
          {!t.is_free && t.prize_pool > 0 && (
            <div className="font-mono text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>${t.prize_pool.toFixed(2)} pool</div>
          )}
        </div>

        <div className="shrink-0 ml-2">
          {isRunning ? (
            <button onClick={() => window.open(`/table/${t.id}/1`, `table-${t.id}`, 'popup,width=1280,height=820,resizable=yes')}
              className="glass-button px-4 py-2 rounded-xl text-sm font-ui font-medium flex items-center gap-2"
              style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', cursor: 'pointer' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#10b981', boxShadow: '0 0 6px #10b981' }} />
              Watch
            </button>
          ) : t.status === 'registering' ? (
            <button className="glass-button btn-cyan px-4 py-2 rounded-xl text-sm font-ui font-semibold" style={{ cursor: 'pointer' }}>
              Join
            </button>
          ) : (
            <span className="font-mono text-xs px-3 py-1.5 rounded-xl" style={{ color: 'rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.04)' }}>Ended</span>
          )}
        </div>
      </div>
    </div>
  )
}
