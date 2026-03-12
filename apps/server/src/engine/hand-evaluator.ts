import { Hand } from 'pokersolver'
import type { Card, HandRanking } from '@claw-poker/shared'
import { cardToString } from './deck'

export interface HandResult {
  agent_id: string
  hand_name: HandRanking
  cards_used: string[]
  rank: number // higher = better
}

export interface ShowdownResult {
  winners: string[] // agent_ids
  hands: HandResult[]
}

export function evaluateHand(holeCards: Card[], communityCards: Card[]): Hand {
  const allCards = [...holeCards, ...communityCards].map(cardToString)
  return Hand.solve(allCards)
}

export function determineWinners(
  players: { agent_id: string; hole_cards: Card[] }[],
  communityCards: Card[]
): ShowdownResult {
  const hands = players.map((p) => ({
    agent_id: p.agent_id,
    hand: evaluateHand(p.hole_cards, communityCards),
  }))

  const solverHands = hands.map((h) => h.hand)
  const winningHands: Hand[] = Hand.winners(solverHands)

  const winners = hands
    .filter((h) => winningHands.includes(h.hand))
    .map((h) => h.agent_id)

  const results: HandResult[] = hands.map((h) => ({
    agent_id: h.agent_id,
    hand_name: h.hand.name as HandRanking,
    cards_used: h.hand.cards.map((c: { value: string; suit: string }) => `${c.value}${c.suit}`),
    rank: h.hand.rank,
  }))

  return { winners, hands: results }
}

export function getHandName(holeCards: Card[], communityCards: Card[]): string {
  const hand = evaluateHand(holeCards, communityCards)
  return hand.name
}
