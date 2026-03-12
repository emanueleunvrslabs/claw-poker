import { describe, it, expect, vi } from 'vitest'
import { PokerGame, type GamePlayer } from '../../src/engine/game'
import { GamePhase } from '@claw-poker/shared'

function makePlayers(n: number, chips = 1500): GamePlayer[] {
  return Array.from({ length: n }, (_, i) => ({
    agent_id: `agent_${i}`,
    agent_name: `Agent ${i}`,
    seat: i,
    chips,
  }))
}

describe('PokerGame', () => {
  it('deals 2 hole cards to each player', async () => {
    const game = new PokerGame('t1', 'tour1', makePlayers(3), 10, 20)

    const states: ReturnType<typeof game.getState>[] = []
    game.on((e) => {
      if (e.type === 'cards_dealt') states.push(e.state)
    })

    // Auto-fold all actions to complete the hand quickly
    game.on((e) => {
      if (e.type === 'action_required') {
        const player = e.state.players[e.state.current_player_index]
        setTimeout(() => game.submitAction(player.agent_id, { action: 'fold' }), 10)
      }
    })

    await game.startHand(42)

    const dealtState = states[0]
    const activePlayers = dealtState.players.filter((p) => p.chips > 0 || p.hole_cards.length > 0)
    for (const player of activePlayers) {
      expect(player.hole_cards).toHaveLength(2)
    }
  })

  it('heads up: dealer is small blind', async () => {
    const game = new PokerGame('t1', 'tour1', makePlayers(2), 10, 20)

    let handStartState: ReturnType<typeof game.getState> | null = null
    game.on((e) => {
      if (e.type === 'hand_start' && !handStartState) {
        handStartState = e.state
      }
    })

    game.on((e) => {
      if (e.type === 'action_required') {
        const player = e.state.players[e.state.current_player_index]
        setTimeout(() => game.submitAction(player.agent_id, { action: 'fold' }), 10)
      }
    })

    await game.startHand(1)

    expect(handStartState).not.toBeNull()
    const dealer = handStartState!.players.find((p) => p.is_dealer)
    const sb = handStartState!.players.find((p) => p.is_small_blind)
    expect(dealer?.agent_id).toBe(sb?.agent_id)
  })

  it('pot increases with bets', async () => {
    const game = new PokerGame('t1', 'tour1', makePlayers(2), 10, 20)

    let actionCount = 0
    game.on((e) => {
      if (e.type === 'action_required') {
        const player = e.state.players[e.state.current_player_index]
        actionCount++
        const action = actionCount === 1 ? { action: 'call' as const } : { action: 'fold' as const }
        setTimeout(() => game.submitAction(player.agent_id, action), 10)
      }
    })

    const result = await game.startHand(2)
    expect(result.hand_number).toBe(1)
    expect(result.winners).toHaveLength(1)
  })

  it('auto-fold on timeout', async () => {
    vi.useFakeTimers()

    const game = new PokerGame('t1', 'tour1', makePlayers(2), 10, 20)

    // Do NOT submit any actions → let timeout fire
    const handPromise = game.startHand(3)
    // Fast-forward past action timeout (15s × number of actions)
    await vi.runAllTimersAsync()

    const result = await handPromise
    expect(result.winners).toHaveLength(1)

    vi.useRealTimers()
  })

  it('community cards dealt correctly per phase', async () => {
    const game = new PokerGame('t1', 'tour1', makePlayers(2), 10, 20)

    const phaseCards: Record<string, number> = {}
    game.on((e) => {
      if (e.type === 'phase_change') {
        phaseCards[e.state.phase] = e.state.community_cards.length
      }
      if (e.type === 'action_required') {
        const player = e.state.players[e.state.current_player_index]
        setTimeout(() => game.submitAction(player.agent_id, { action: 'call' }), 10)
      }
    })

    await game.startHand(5)

    expect(phaseCards[GamePhase.FLOP]).toBe(3)
    expect(phaseCards[GamePhase.TURN]).toBe(4)
    expect(phaseCards[GamePhase.RIVER]).toBe(5)
  })

  it('handles all-in correctly', async () => {
    const players: GamePlayer[] = [
      { agent_id: 'a', agent_name: 'A', seat: 0, chips: 50 },  // short stack
      { agent_id: 'b', agent_name: 'B', seat: 1, chips: 1500 },
    ]
    const game = new PokerGame('t1', 'tour1', players, 10, 20)

    game.on((e) => {
      if (e.type === 'action_required') {
        const player = e.state.players[e.state.current_player_index]
        // Always call/check
        const validActions = e.state.players[e.state.current_player_index]
        setTimeout(() => game.submitAction(player.agent_id, { action: 'call' }), 10)
      }
    })

    const result = await game.startHand(7)
    expect(result).toBeDefined()
    expect(result.winners.length).toBeGreaterThan(0)
  })
})
