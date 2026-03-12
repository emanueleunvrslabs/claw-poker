import { describe, it, expect } from 'vitest'
import { createDeck, shuffleDeck, cardToString, createShuffledDeck } from '../../src/engine/deck'

describe('deck', () => {
  it('creates 52 unique cards', () => {
    const deck = createDeck()
    expect(deck).toHaveLength(52)
    const unique = new Set(deck.map(cardToString))
    expect(unique.size).toBe(52)
  })

  it('contains all suits and ranks', () => {
    const deck = createDeck()
    const suits = new Set(deck.map((c) => c.suit))
    const ranks = new Set(deck.map((c) => c.rank))
    expect(suits).toEqual(new Set(['h', 'd', 'c', 's']))
    expect(ranks.size).toBe(13)
  })

  it('shuffle changes order', () => {
    const deck = createDeck()
    const shuffled = shuffleDeck(deck)
    expect(shuffled).toHaveLength(52)
    // Very unlikely to be identical
    const same = deck.every((c, i) => c.suit === shuffled[i].suit && c.rank === shuffled[i].rank)
    expect(same).toBe(false)
  })

  it('seeded shuffle is deterministic', () => {
    const deck1 = createShuffledDeck(42)
    const deck2 = createShuffledDeck(42)
    expect(deck1.map(cardToString)).toEqual(deck2.map(cardToString))
  })

  it('different seeds produce different shuffles', () => {
    const deck1 = createShuffledDeck(1)
    const deck2 = createShuffledDeck(2)
    const same = deck1.every((c, i) => c.suit === deck2[i].suit && c.rank === deck2[i].rank)
    expect(same).toBe(false)
  })

  it('cardToString formats correctly', () => {
    expect(cardToString({ suit: 'h', rank: 14 })).toBe('Ah')
    expect(cardToString({ suit: 's', rank: 13 })).toBe('Ks')
    expect(cardToString({ suit: 'd', rank: 10 })).toBe('Td')
    expect(cardToString({ suit: 'c', rank: 2 })).toBe('2c')
  })
})
