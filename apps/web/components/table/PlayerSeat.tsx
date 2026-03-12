'use client'
import { CardComponent } from './CardComponent'
import type { Card } from '@claw-poker/shared'

interface Player {
  agent_id: string
  agent_name: string
  chips: number
  bet_this_round: number
  hole_cards: Card[]
  is_folded: boolean
  is_all_in: boolean
  is_dealer: boolean
  is_small_blind: boolean
  is_big_blind: boolean
  is_current_turn: boolean
  time_remaining?: number
}

interface Props {
  player: Player
  position: 'top' | 'top-left' | 'top-right' | 'left' | 'right' | 'bottom-left' | 'bottom-right' | 'bottom'
  isEmpty?: boolean
}

export function PlayerSeat({ player, position, isEmpty = false }: Props) {
  const isVertical = position === 'top' || position === 'bottom'
  const isActive = player.is_current_turn && !player.is_folded

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center gap-2 opacity-20">
        <div
          className="w-10 h-10 rounded-full"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px dashed rgba(255,255,255,0.15)',
          }}
        />
        <div className="font-mono text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>
          Empty
        </div>
      </div>
    )
  }

  return (
    <div className={`flex flex-col items-center gap-2 ${player.is_folded ? 'opacity-40' : ''}`}>
      {/* Cards */}
      <div className="flex gap-1">
        {player.hole_cards.length > 0 ? (
          player.hole_cards.map((card, i) => (
            <CardComponent key={i} card={card} size="sm" delay={i * 0.1} />
          ))
        ) : (
          <>
            <CardComponent faceDown size="sm" />
            <CardComponent faceDown size="sm" delay={0.08} />
          </>
        )}
      </div>

      {/* Player info bubble */}
      <div
        className="relative px-3 py-2 rounded-xl min-w-[100px] text-center transition-all duration-300"
        style={{
          background: isActive
            ? 'rgba(230,57,70,0.12)'
            : player.is_all_in
            ? 'rgba(251,191,36,0.12)'
            : 'rgba(255,255,255,0.05)',
          border: isActive
            ? '1px solid rgba(230,57,70,0.4)'
            : player.is_all_in
            ? '1px solid rgba(251,191,36,0.4)'
            : '1px solid rgba(255,255,255,0.08)',
          boxShadow: isActive
            ? '0 0 20px rgba(230,57,70,0.2)'
            : player.is_all_in
            ? '0 0 20px rgba(251,191,36,0.2)'
            : 'none',
          backdropFilter: 'blur(12px)',
        }}
      >
        {/* Dealer/Blind badges */}
        <div className="absolute -top-2 -right-2 flex gap-1">
          {player.is_dealer && (
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-mono font-bold"
              style={{ background: '#fbbf24', color: '#000' }}
            >
              D
            </span>
          )}
          {player.is_small_blind && !player.is_dealer && (
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-mono font-bold"
              style={{ background: '#e63946', color: '#000' }}
            >
              S
            </span>
          )}
          {player.is_big_blind && (
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-mono font-bold"
              style={{ background: '#8b5cf6', color: '#fff' }}
            >
              B
            </span>
          )}
        </div>

        {/* Timer ring for active player */}
        {isActive && player.time_remaining !== undefined && (
          <div className="absolute -inset-1 rounded-xl pointer-events-none">
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              <rect
                x="1" y="1" width="98" height="98" rx="12"
                fill="none"
                stroke="rgba(230,57,70,0.6)"
                strokeWidth="2"
                strokeDasharray="100"
                strokeDashoffset={100 - (player.time_remaining / 15) * 100}
                style={{ transition: 'stroke-dashoffset 1s linear' }}
              />
            </svg>
          </div>
        )}

        <div
          className="font-ui text-xs font-semibold truncate max-w-[90px]"
          style={{ color: isActive ? '#e63946' : 'rgba(255,255,255,0.9)' }}
        >
          {player.agent_name}
        </div>

        <div
          className="font-mono text-sm font-medium"
          style={{ color: player.is_all_in ? '#fbbf24' : 'rgba(255,255,255,0.6)' }}
        >
          {player.is_all_in ? 'ALL IN' : player.chips.toLocaleString()}
        </div>

        {/* Bet */}
        {player.bet_this_round > 0 && (
          <div
            className="absolute -bottom-6 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold whitespace-nowrap"
            style={{
              background: 'rgba(251,191,36,0.15)',
              border: '1px solid rgba(251,191,36,0.3)',
              color: '#fbbf24',
            }}
          >
            {player.bet_this_round}
          </div>
        )}

        {/* Folded overlay */}
        {player.is_folded && (
          <div
            className="absolute inset-0 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.5)' }}
          >
            <span className="font-mono text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
              FOLD
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
