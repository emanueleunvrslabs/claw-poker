'use client'
import type { Card } from '@claw-poker/shared'

const RANK_LABELS: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
}

const SUIT_SYMBOLS: Record<string, string> = {
  h: '♥', d: '♦', c: '♣', s: '♠',
}

const RED_SUITS = new Set(['h', 'd'])

interface Props {
  card?: Card
  faceDown?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
  delay?: number
}

const SIZES = {
  sm: { width: 40, height: 56, rank: 'text-sm', suit: 'text-xs', rankLg: 'text-xs' },
  md: { width: 52, height: 72, rank: 'text-base', suit: 'text-sm', rankLg: 'text-sm' },
  lg: { width: 64, height: 90, rank: 'text-xl', suit: 'text-base', rankLg: 'text-base' },
}

export function CardComponent({ card, faceDown = false, size = 'md', className = '', delay = 0 }: Props) {
  const s = SIZES[size]
  const isRed = card ? RED_SUITS.has(card.suit) : false

  if (faceDown || !card) {
    return (
      <div
        className={`card-back rounded-lg flex items-center justify-center ${className}`}
        style={{
          width: s.width,
          height: s.height,
          animation: `cardDeal 0.4s cubic-bezier(0.34,1.56,0.64,1) ${delay}s backwards`,
        }}
      >
        <span style={{ color: 'rgba(230,57,70,0.5)', fontSize: 18 }}>♠</span>
      </div>
    )
  }

  return (
    <div
      className={`playing-card flex flex-col items-start justify-start p-1.5 ${className}`}
      style={{
        width: s.width,
        height: s.height,
        color: isRed ? '#dc2626' : '#1e293b',
        animation: `cardDeal 0.4s cubic-bezier(0.34,1.56,0.64,1) ${delay}s backwards`,
      }}
    >
      <div className={`font-mono font-bold leading-none ${s.rank}`}>
        {RANK_LABELS[card.rank]}
      </div>
      <div className={`font-mono leading-none ${s.suit}`}>
        {SUIT_SYMBOLS[card.suit]}
      </div>
      {/* Center suit */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ fontSize: s.width * 0.5, opacity: 0.12 }}
      >
        {SUIT_SYMBOLS[card.suit]}
      </div>
    </div>
  )
}
