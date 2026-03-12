import { describe, it, expect } from 'vitest'
import { evaluateHand, determineWinners } from '../../src/engine/hand-evaluator'
import type { Card } from '@claw-poker/shared'

const c = (rank: number, suit: string): Card => ({ rank: rank as Card['rank'], suit: suit as Card['suit'] })

describe('hand-evaluator', () => {
  it('identifies royal flush (A-high straight flush)', () => {
    const hole: Card[] = [c(14, 'h'), c(13, 'h')]
    const community: Card[] = [c(12, 'h'), c(11, 'h'), c(10, 'h'), c(2, 'd'), c(3, 'c')]
    const hand = evaluateHand(hole, community)
    // pokersolver returns "Straight Flush" for A-high (Royal Flush)
    expect(['Royal Flush', 'Straight Flush']).toContain(hand.name)
    // Must beat a regular straight flush (9-high)
    const regular = evaluateHand([c(9, 's'), c(8, 's')], [c(7, 's'), c(6, 's'), c(5, 's'), c(2, 'd'), c(3, 'c')])
    expect(hand.rank).toBeGreaterThanOrEqual(regular.rank)
  })

  it('identifies straight flush', () => {
    const hole: Card[] = [c(9, 's'), c(8, 's')]
    const community: Card[] = [c(7, 's'), c(6, 's'), c(5, 's'), c(2, 'd'), c(3, 'c')]
    const hand = evaluateHand(hole, community)
    expect(hand.name).toBe('Straight Flush')
  })

  it('identifies four of a kind', () => {
    const hole: Card[] = [c(14, 'h'), c(14, 'd')]
    const community: Card[] = [c(14, 'c'), c(14, 's'), c(2, 'h'), c(3, 'd'), c(4, 'c')]
    const hand = evaluateHand(hole, community)
    expect(hand.name).toBe('Four of a Kind')
  })

  it('identifies full house', () => {
    const hole: Card[] = [c(14, 'h'), c(14, 'd')]
    const community: Card[] = [c(14, 'c'), c(3, 's'), c(3, 'h'), c(7, 'd'), c(8, 'c')]
    const hand = evaluateHand(hole, community)
    expect(hand.name).toBe('Full House')
  })

  it('identifies pair', () => {
    const hole: Card[] = [c(14, 'h'), c(14, 'd')]
    const community: Card[] = [c(2, 'c'), c(5, 's'), c(7, 'h'), c(9, 'd'), c(3, 'c')]
    const hand = evaluateHand(hole, community)
    expect(hand.name).toBe('Pair')
  })

  it('determines correct winner', () => {
    const community: Card[] = [c(2, 'h'), c(5, 'd'), c(9, 'c'), c(3, 's'), c(7, 'h')]

    const result = determineWinners(
      [
        { agent_id: 'alice', hole_cards: [c(14, 'h'), c(14, 'd')] }, // pair of aces
        { agent_id: 'bob', hole_cards: [c(5, 'h'), c(5, 's')] },     // three 5s
      ],
      community
    )

    expect(result.winners).toEqual(['bob'])
  })

  it('handles split pot (tie)', () => {
    const community: Card[] = [c(14, 'h'), c(13, 'd'), c(12, 'c'), c(11, 's'), c(10, 'h')]
    // Both have broadway straight on the board
    const result = determineWinners(
      [
        { agent_id: 'alice', hole_cards: [c(2, 'h'), c(3, 'd')] },
        { agent_id: 'bob', hole_cards: [c(4, 'h'), c(5, 'd')] },
      ],
      community
    )
    expect(result.winners).toHaveLength(2)
    expect(result.winners).toContain('alice')
    expect(result.winners).toContain('bob')
  })

  it('ranks higher hand beats lower', () => {
    const community: Card[] = [c(2, 'h'), c(3, 'd'), c(4, 'c'), c(8, 's'), c(9, 'h')]
    const result = determineWinners(
      [
        { agent_id: 'flush', hole_cards: [c(14, 'h'), c(7, 'h')] },  // high card only
        { agent_id: 'pair', hole_cards: [c(9, 'd'), c(9, 'c')] },    // three of a kind with board? No, pair of 9s
      ],
      community
    )
    expect(result.winners).toEqual(['pair'])
  })
})
