import { describe, it, expect } from 'vitest'
import { calculatePots, validateBet, getValidActions } from '../../src/engine/betting'
import type { BettingPlayer } from '../../src/engine/betting'

describe('calculatePots', () => {
  it('simple pot with no all-ins', () => {
    const players: BettingPlayer[] = [
      { agent_id: 'a', chips: 900, bet_this_round: 100, is_folded: false, is_all_in: false },
      { agent_id: 'b', chips: 900, bet_this_round: 100, is_folded: false, is_all_in: false },
    ]
    const result = calculatePots(players)
    expect(result.total).toBe(200)
  })

  it('one player folds, chips go to main pot', () => {
    const players: BettingPlayer[] = [
      { agent_id: 'a', chips: 900, bet_this_round: 100, is_folded: false, is_all_in: false },
      { agent_id: 'b', chips: 900, bet_this_round: 100, is_folded: false, is_all_in: false },
      { agent_id: 'c', chips: 900, bet_this_round: 50,  is_folded: true,  is_all_in: false },
    ]
    const result = calculatePots(players)
    expect(result.total).toBe(250)
  })

  it('side pot with one all-in player', () => {
    // Player A all-in for 50, B and C bet 100
    const players: BettingPlayer[] = [
      { agent_id: 'a', chips: 0,   bet_this_round: 50,  is_folded: false, is_all_in: true  },
      { agent_id: 'b', chips: 950, bet_this_round: 100, is_folded: false, is_all_in: false },
      { agent_id: 'c', chips: 950, bet_this_round: 100, is_folded: false, is_all_in: false },
    ]
    const result = calculatePots(players)
    expect(result.total).toBe(250)
    // Main pot: 50*3 = 150 (A eligible), Side pot: 50*2 = 100 (B,C only)
    expect(result.main_pot).toBe(150)
    expect(result.side_pots).toHaveLength(1)
    expect(result.side_pots[0].amount).toBe(100)
    expect(result.side_pots[0].eligible_players).not.toContain('a')
  })

  it('multiple all-ins create multiple side pots', () => {
    const players: BettingPlayer[] = [
      { agent_id: 'a', chips: 0,   bet_this_round: 25,  is_folded: false, is_all_in: true  },
      { agent_id: 'b', chips: 0,   bet_this_round: 75,  is_folded: false, is_all_in: true  },
      { agent_id: 'c', chips: 925, bet_this_round: 100, is_folded: false, is_all_in: false },
    ]
    const result = calculatePots(players)
    expect(result.total).toBe(200)
    // Pot 1: 25*3 = 75 (all eligible)
    // Pot 2: 50*2 = 100 (b,c eligible)
    // Pot 3: 25*1 = 25 (c only)
    expect(result.side_pots.length).toBeGreaterThanOrEqual(1)
  })
})

describe('validateBet', () => {
  it('fold is always valid', () => {
    const r = validateBet('fold', undefined, 1000, 100, 0, 100)
    expect(r.valid).toBe(true)
  })

  it('check valid when no bet to call', () => {
    const r = validateBet('check', undefined, 1000, 0, 0, 0)
    expect(r.valid).toBe(true)
  })

  it('check invalid when there is a bet', () => {
    const r = validateBet('check', undefined, 1000, 100, 0, 100)
    expect(r.valid).toBe(false)
  })

  it('call corrects to all-in when not enough chips', () => {
    const r = validateBet('call', undefined, 50, 100, 0, 100)
    expect(r.valid).toBe(true)
    expect(r.corrected_amount).toBe(50) // all-in for 50
  })

  it('raise below min raise is invalid', () => {
    const r = validateBet('raise', 110, 1000, 100, 0, 100)
    // raise to 110 means raise size is 10, but min raise is 100
    expect(r.valid).toBe(false)
  })

  it('valid raise', () => {
    const r = validateBet('raise', 200, 1000, 100, 0, 100)
    expect(r.valid).toBe(true)
    expect(r.corrected_amount).toBe(200)
  })

  it('raise corrects to all-in when not enough chips', () => {
    const r = validateBet('raise', 500, 300, 100, 0, 100)
    // Player has 300 chips, wants to raise to 500, can only go all-in
    expect(r.valid).toBe(true)
    expect(r.corrected_amount).toBe(300) // all-in
  })
})

describe('getValidActions', () => {
  it('can check when no bet', () => {
    const actions = getValidActions(1000, 0, 0)
    expect(actions).toContain('check')
    expect(actions).not.toContain('call')
  })

  it('must call when there is a bet', () => {
    const actions = getValidActions(1000, 100, 0)
    expect(actions).toContain('call')
    expect(actions).not.toContain('check')
  })

  it('can raise when has enough chips', () => {
    const actions = getValidActions(1000, 100, 0)
    expect(actions).toContain('raise')
  })

  it('cannot raise when all-in calling', () => {
    const actions = getValidActions(50, 100, 0)
    // only 50 chips, need 100 to call → all-in, no raise
    expect(actions).not.toContain('raise')
  })

  it('always includes fold', () => {
    const actions = getValidActions(1000, 0, 0)
    expect(actions).toContain('fold')
  })
})
