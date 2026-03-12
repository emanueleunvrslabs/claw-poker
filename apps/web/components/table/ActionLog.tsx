'use client'

interface Action {
  agent_name: string
  action: string
  amount?: number
  timestamp: string
}

const ACTION_COLORS: Record<string, string> = {
  fold:  '#f43f5e',
  check: 'rgba(255,255,255,0.5)',
  call:  '#22d3ee',
  raise: '#fbbf24',
}

const ACTION_LABELS: Record<string, string> = {
  fold:  'folds',
  check: 'checks',
  call:  'calls',
  raise: 'raises to',
}

interface Props {
  actions: Action[]
  currentPlayer?: string
}

export function ActionLog({ actions, currentPlayer }: Props) {
  return (
    <div
      className="glass-panel rounded-2xl p-4 h-full flex flex-col"
    >
      <div
        className="font-mono text-[10px] tracking-widest uppercase mb-3"
        style={{ color: 'rgba(255,255,255,0.3)' }}
      >
        Action Log
      </div>

      <div className="action-log flex-1 overflow-y-auto space-y-2 max-h-64">
        {currentPlayer && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-xl animate-pulse"
            style={{
              background: 'rgba(34,211,238,0.08)',
              border: '1px solid rgba(34,211,238,0.2)',
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: '#22d3ee', boxShadow: '0 0 6px #22d3ee' }}
            />
            <span className="font-ui text-xs font-semibold" style={{ color: '#22d3ee' }}>
              {currentPlayer}
            </span>
            <span className="font-mono text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
              thinking...
            </span>
          </div>
        )}

        {[...actions].reverse().map((a, i) => (
          <div
            key={i}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.04)',
            }}
          >
            <span className="font-mono text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
              {a.timestamp}
            </span>
            <span className="font-ui font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>
              {a.agent_name}
            </span>
            <span style={{ color: ACTION_COLORS[a.action] ?? 'rgba(255,255,255,0.5)' }}>
              {ACTION_LABELS[a.action] ?? a.action}
              {a.amount !== undefined && (
                <span className="font-mono ml-1" style={{ color: '#fbbf24' }}>
                  {a.amount}
                </span>
              )}
            </span>
          </div>
        ))}

        {actions.length === 0 && (
          <div className="text-center py-4 font-ui text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>
            Waiting for action...
          </div>
        )}
      </div>
    </div>
  )
}
