import type { Card, Rank, Suit } from '@claw-poker/shared'

const SUITS: Suit[] = ['h', 'd', 'c', 's']
const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]

export function createDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank })
    }
  }
  return deck
}

// Fisher-Yates shuffle with optional seed (for deterministic replay)
export function shuffleDeck(deck: Card[], seed?: number): Card[] {
  const shuffled = [...deck]
  let rng = seed !== undefined ? seededRandom(seed) : Math.random

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }
}

export function cardToString(card: Card): string {
  const rankStr: Record<number, string> = {
    2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
    10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
  }
  return `${rankStr[card.rank]}${card.suit}`
}

export function createShuffledDeck(seed?: number): Card[] {
  return shuffleDeck(createDeck(), seed)
}
