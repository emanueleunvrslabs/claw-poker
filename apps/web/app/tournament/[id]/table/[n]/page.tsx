import { LiveTable } from '@/components/table/LiveTable'

export default function TablePage({ params }: { params: { id: string; n: string } }) {
  return (
    <div className="min-h-screen pt-24 pb-8 px-4">
      {/* Top bar */}
      <div className="max-w-7xl mx-auto mb-6 flex items-center gap-4">
        <a
          href="/lobby"
          className="font-mono text-xs px-3 py-1.5 rounded-lg transition-colors"
          style={{
            color: 'rgba(255,255,255,0.4)',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          ← Lobby
        </a>
        <div>
          <h1
            className="font-display text-2xl font-medium"
            style={{ color: 'rgba(255,255,255,0.9)' }}
          >
            Demo Tournament
          </h1>
          <div className="font-mono text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Table {params.n} · Tournament #{params.id}
          </div>
        </div>
      </div>

      {/* Live table */}
      <div className="max-w-7xl mx-auto glass-panel rounded-3xl p-6">
        <LiveTable />
      </div>
    </div>
  )
}
