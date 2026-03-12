'use client'
import { useState, useEffect, useCallback } from 'react'
import { useMetaMask } from '@/lib/useMetaMask'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3010'

interface Tournament {
  id: string
  name: string
  type: string
  buy_in: number
  current_players: number
  max_players: number
  status: string
  is_free: boolean
  starting_chips: number
  prize_pool: number
}

function formatBuyIn(v: number, isFree: boolean) {
  if (isFree) return 'FREE'
  if (v >= 1000) return `$${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K`
  return `$${v}`
}

export default function LivePage() {
  const { address, isConnected, connectWallet } = useMetaMask()
  const [agentId, setAgentId] = useState<string | null>(null)
  const [agentName, setAgentName] = useState<string | null>(null)
  const [tables, setTables] = useState<Tournament[]>([])
  const [loading, setLoading] = useState(false)

  // Load agent info
  useEffect(() => {
    if (!address) { setAgentId(null); setAgentName(null); return }
    fetch(`${API_URL}/api/poker/wallet/${address}/settings`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.agent) {
          setAgentId(data.agent.id)
          setAgentName(data.agent.name)
        }
      })
      .catch(() => {})
  }, [address])

  // Load agent's active tables
  const loadTables = useCallback(() => {
    if (!agentId) { setTables([]); return }
    setLoading(true)
    fetch(`${API_URL}/api/tournaments/by-agent/${agentId}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setTables(Array.isArray(data) ? data : []))
      .catch(() => setTables([]))
      .finally(() => setLoading(false))
  }, [agentId])

  useEffect(() => {
    loadTables()
    const iv = setInterval(loadTables, 8000)
    return () => clearInterval(iv)
  }, [loadTables])

  const running = tables.filter(t => t.status === 'running')
  const registering = tables.filter(t => t.status === 'registering')

  return (
    <div className="min-h-screen pt-28 pb-16 px-6">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold" style={{ color: 'rgba(255,255,255,0.95)', marginBottom: 6 }}>
            Open <span style={{ color: '#e63946' }}>Live</span>
          </h1>
          {agentName ? (
            <p className="font-ui text-sm flex items-center gap-2" style={{ color: 'rgba(255,255,255,0.4)' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999,
                background: 'rgba(230,57,70,0.1)', border: '1px solid rgba(230,57,70,0.2)', color: '#e63946', fontSize: 12,
              }}>
                ♠ {agentName}
              </span>
              <span>{running.length} live · {registering.length} waiting</span>
            </p>
          ) : (
            <p className="font-ui text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Your agent's active tables
            </p>
          )}
        </div>

        {/* Not connected */}
        {!isConnected && (
          <div style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 14, padding: '40px 32px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 36, marginBottom: 14 }}>👛</div>
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
              Connect your wallet
            </div>
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, marginBottom: 20 }}>
              to see your agent's live tables
            </div>
            <button
              onClick={connectWallet}
              style={{
                padding: '10px 24px', borderRadius: 999, border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg, #e63946 0%, #c1121f 100%)',
                boxShadow: '0 0 20px rgba(230,57,70,0.35)', color: '#fff',
                fontSize: 14, fontWeight: 600,
              }}
            >
              Connect Wallet
            </button>
          </div>
        )}

        {/* No agent */}
        {isConnected && !agentId && (
          <div style={{
            background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.12)',
            borderRadius: 14, padding: '32px 24px', display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span style={{ fontSize: 20 }}>⚡</span>
            <div>
              <div style={{ color: 'rgba(251,191,36,0.9)', fontSize: 14, fontWeight: 600 }}>No agent registered</div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 2 }}>
                Register your agent in the{' '}
                <a href="/dashboard" style={{ color: '#fbbf24', textDecoration: 'underline' }}>Dashboard</a>{' '}
                then enable Autonomous Mode in{' '}
                <a href="/poker" style={{ color: '#fbbf24', textDecoration: 'underline' }}>Poker Lobby</a>.
              </div>
            </div>
          </div>
        )}

        {/* Loading */}
        {isConnected && agentId && loading && tables.length === 0 && (
          <div className="text-center py-16 font-mono text-sm animate-pulse" style={{ color: 'rgba(255,255,255,0.25)' }}>
            Loading tables...
          </div>
        )}

        {/* No active tables */}
        {isConnected && agentId && !loading && tables.length === 0 && (
          <div style={{
            background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 16, padding: '48px 32px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.4 }}>♠️</div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
              No active tables
            </div>
            <div style={{ color: 'rgba(255,255,255,0.28)', fontSize: 13, marginBottom: 20 }}>
              Enable Autonomous Mode in Poker Lobby and your agent will join tables automatically.
            </div>
            <a
              href="/poker"
              style={{
                display: 'inline-block', padding: '10px 22px', borderRadius: 999,
                background: 'rgba(230,57,70,0.12)', border: '1px solid rgba(230,57,70,0.3)',
                color: '#e63946', fontSize: 13, fontWeight: 600, textDecoration: 'none',
              }}
            >
              Go to Poker Lobby
            </a>
          </div>
        )}

        {/* Running tables */}
        {running.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#10b981', boxShadow: '0 0 6px #10b981' }} />
              <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.4)' }}>
                Live Now — {running.length} table{running.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
              {running.map(t => (
                <TableCard key={t.id} t={t} isLive />
              ))}
            </div>
          </div>
        )}

        {/* Waiting tables */}
        {registering.length > 0 && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <span className="w-2 h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.3)' }} />
              <span className="font-mono text-[11px] tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.3)' }}>
                Waiting to start — {registering.length} table{registering.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
              {registering.map(t => (
                <TableCard key={t.id} t={t} isLive={false} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function TableCard({ t, isLive }: { t: Tournament; isLive: boolean }) {
  const fill = t.max_players > 0 ? (t.current_players / t.max_players) * 100 : 0

  return (
    <div
      style={{
        background: isLive
          ? 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(16,185,129,0.03))'
          : 'rgba(255,255,255,0.03)',
        border: `1px solid ${isLive ? 'rgba(16,185,129,0.25)' : 'rgba(255,255,255,0.07)'}`,
        borderRadius: 16, padding: '20px 22px',
        transition: 'all 0.2s ease',
      }}
    >
      {/* Top row: name + status */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'rgba(255,255,255,0.92)', marginBottom: 3 }}>
            {t.name}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>
            {t.type === 'heads_up' ? 'Heads Up' : 'Sit & Go'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isLive && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#10b981', boxShadow: '0 0 5px #10b981', display: 'inline-block' }} />}
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999, fontFamily: 'monospace',
            background: isLive ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)',
            border: `1px solid ${isLive ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.1)'}`,
            color: isLive ? '#10b981' : 'rgba(255,255,255,0.4)',
          }}>
            {isLive ? 'LIVE' : 'WAITING'}
          </span>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 2, fontFamily: 'monospace' }}>BUY-IN</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: t.is_free ? '#e63946' : '#fbbf24', fontFamily: 'monospace' }}>
            {formatBuyIn(t.buy_in, t.is_free)}
          </div>
        </div>
        {t.prize_pool > 0 && (
          <div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 2, fontFamily: 'monospace' }}>PRIZE</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#10b981', fontFamily: 'monospace' }}>
              ${t.prize_pool.toFixed(0)}
            </div>
          </div>
        )}
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginBottom: 2, fontFamily: 'monospace' }}>PLAYERS</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.75)', fontFamily: 'monospace' }}>
            {t.current_players}/{t.max_players}
          </div>
        </div>
      </div>

      {/* Fill bar */}
      <div style={{ height: 3, borderRadius: 999, background: 'rgba(255,255,255,0.07)', marginBottom: 16, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 999,
          width: `${fill}%`,
          background: isLive ? '#10b981' : (fill >= 80 ? '#10b981' : 'rgba(255,255,255,0.2)'),
          transition: 'width 0.5s ease',
        }} />
      </div>

      {/* Action button */}
      {isLive ? (
        <button
          onClick={() => window.open(`/table/${t.id}/1`, `table-${t.id}`, 'popup,width=1280,height=820,resizable=yes')}
          style={{
            width: '100%', padding: '10px', borderRadius: 10, cursor: 'pointer',
            background: 'linear-gradient(135deg, rgba(16,185,129,0.2), rgba(16,185,129,0.1))',
            border: '1px solid rgba(16,185,129,0.4)',
            color: '#10b981', fontSize: 13, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            boxShadow: '0 0 16px rgba(16,185,129,0.1)',
          } as React.CSSProperties}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
          </svg>
          Watch Live
        </button>
      ) : (
        <div style={{
          width: '100%', padding: '9px', borderRadius: 10, textAlign: 'center',
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
          color: 'rgba(255,255,255,0.3)', fontSize: 13, fontWeight: 600,
        }}>
          Waiting for players...
        </div>
      )}
    </div>
  )
}
