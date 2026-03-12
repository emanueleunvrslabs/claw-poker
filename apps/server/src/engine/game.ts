import { GamePhase, type Card, type AgentAction, type GameState, type PlayerState, type SidePot } from '@claw-poker/shared'
import { ACTION_TIMEOUT_SECONDS } from '@claw-poker/shared'
import { createShuffledDeck } from './deck'
import { calculatePots, validateBet, getValidActions } from './betting'
import { determineWinners, type ShowdownResult } from './hand-evaluator'

export interface GamePlayer {
  agent_id: string
  agent_name: string
  seat: number
  chips: number
}

export interface HandResult {
  hand_number: number
  winners: string[]
  pots: { amount: number; winners: string[] }[]
  showdown?: ShowdownResult
  eliminated: string[] // agent_ids that ran out of chips
}

export type GameEventType =
  | 'hand_start'
  | 'cards_dealt'
  | 'action_required'
  | 'action_taken'
  | 'phase_change'
  | 'hand_end'
  | 'game_end'

export interface GameEvent {
  type: GameEventType
  state: GameState
  data?: Record<string, unknown>
}

export type GameEventHandler = (event: GameEvent) => void

export class PokerGame {
  private state: GameState
  private deck: Card[] = []
  private actionTimer: ReturnType<typeof setTimeout> | null = null
  private eventHandlers: GameEventHandler[] = []

  constructor(
    tableId: string,
    tournamentId: string,
    players: GamePlayer[],
    smallBlind: number,
    bigBlind: number,
    ante: number = 0
  ) {
    const playerStates: PlayerState[] = players.map((p) => ({
      agent_id: p.agent_id,
      agent_name: p.agent_name,
      seat: p.seat,
      chips: p.chips,
      bet_this_round: 0,
      hole_cards: [],
      is_folded: false,
      is_all_in: false,
      is_dealer: false,
      is_small_blind: false,
      is_big_blind: false,
      is_sitting_out: false,
      has_acted_this_round: false,
    }))

    this.state = {
      table_id: tableId,
      tournament_id: tournamentId,
      hand_number: 0,
      phase: GamePhase.WAITING,
      community_cards: [],
      pot: 0,
      side_pots: [],
      players: playerStates,
      current_player_index: 0,
      dealer_index: 0,
      small_blind_index: 0,
      big_blind_index: 0,
      min_bet: bigBlind,
      min_raise: bigBlind,
      last_raise_size: bigBlind,
      small_blind: smallBlind,
      big_blind: bigBlind,
      ante,
    }
  }

  on(handler: GameEventHandler): void {
    this.eventHandlers.push(handler)
  }

  getState(): GameState {
    return { ...this.state }
  }

  getActivePlayers(): PlayerState[] {
    return this.state.players.filter((p) => !p.is_folded && !p.is_sitting_out)
  }

  getPlayersWithChips(): PlayerState[] {
    return this.state.players.filter((p) => p.chips > 0 || p.is_all_in)
  }

  updateBlinds(smallBlind: number, bigBlind: number, ante: number): void {
    this.state.small_blind = smallBlind
    this.state.big_blind = bigBlind
    this.state.ante = ante
    this.state.min_bet = bigBlind
    this.state.min_raise = bigBlind
    this.state.last_raise_size = bigBlind
  }

  async startHand(seed?: number): Promise<HandResult> {
    if (this.getPlayersWithChips().length < 2) {
      throw new Error('Need at least 2 players with chips to start a hand')
    }

    this.state.hand_number++
    this.deck = createShuffledDeck(seed)

    // Reset player states for new hand
    for (const player of this.state.players) {
      player.hole_cards = []
      player.bet_this_round = 0
      player.is_folded = player.chips === 0 // sit out if no chips
      player.is_all_in = false
      player.is_dealer = false
      player.is_small_blind = false
      player.is_big_blind = false
      player.has_acted_this_round = false
    }

    this.state.community_cards = []
    this.state.pot = 0
    this.state.side_pots = []
    this.state.phase = GamePhase.WAITING

    // Advance dealer button
    this.advanceDealer()

    // Post antes
    if (this.state.ante > 0) {
      this.postAntes()
    }

    // Post blinds
    this.postBlinds()

    // Deal hole cards
    this.dealHoleCards()

    this.state.phase = GamePhase.PREFLOP
    this.emit('hand_start', {})
    this.emit('cards_dealt', {})

    // Preflop: action starts left of big blind (clockwise = index - 1)
    const activePlayers = this.getActivePlayers()
    const np = this.state.players.length
    let firstActorIndex = (this.state.big_blind_index - 1 + np) % np
    // Skip folded/sitting out players
    while (this.state.players[firstActorIndex].is_folded || this.state.players[firstActorIndex].is_sitting_out) {
      firstActorIndex = (firstActorIndex - 1 + np) % np
    }
    this.state.current_player_index = firstActorIndex

    // Run betting rounds
    await this.runBettingRound()

    if (this.getActivePlayers().length > 1) {
      // Flop
      this.dealCommunityCards(3)
      this.state.phase = GamePhase.FLOP
      this.emit('phase_change', { phase: GamePhase.FLOP })
      await this.runBettingRound()
    }

    if (this.getActivePlayers().length > 1) {
      // Turn
      this.dealCommunityCards(1)
      this.state.phase = GamePhase.TURN
      this.emit('phase_change', { phase: GamePhase.TURN })
      await this.runBettingRound()
    }

    if (this.getActivePlayers().length > 1) {
      // River
      this.dealCommunityCards(1)
      this.state.phase = GamePhase.RIVER
      this.emit('phase_change', { phase: GamePhase.RIVER })
      await this.runBettingRound()
    }

    // Showdown
    this.state.phase = GamePhase.SHOWDOWN
    this.emit('phase_change', { phase: GamePhase.SHOWDOWN })

    const result = this.resolveShowdown()

    this.emit('hand_end', { result })

    return result
  }

  private advanceDealer(): void {
    const players = this.state.players
    const n = players.length
    const playersWithChips = players.filter((p) => p.chips > 0)

    // Find next dealer among players with chips (clockwise = index - 1)
    let nextDealer = (this.state.dealer_index - 1 + n) % n
    let attempts = 0
    while (players[nextDealer].chips === 0 && attempts < n) {
      nextDealer = (nextDealer - 1 + n) % n
      attempts++
    }

    this.state.dealer_index = nextDealer
    players[nextDealer].is_dealer = true

    if (playersWithChips.length === 2) {
      // Heads-up: dealer is SB
      this.state.small_blind_index = nextDealer
      this.state.big_blind_index = (nextDealer - 1 + n) % n
    } else {
      this.state.small_blind_index = this.nextActiveIndex(nextDealer)
      this.state.big_blind_index = this.nextActiveIndex(this.state.small_blind_index)
    }

    players[this.state.small_blind_index].is_small_blind = true
    players[this.state.big_blind_index].is_big_blind = true
  }

  private nextActiveIndex(fromIndex: number): number {
    const n = this.state.players.length
    let idx = (fromIndex - 1 + n) % n
    let attempts = 0
    while ((this.state.players[idx].chips === 0 || this.state.players[idx].is_folded) && attempts < n) {
      idx = (idx - 1 + n) % n
      attempts++
    }
    return idx
  }

  private postAntes(): void {
    for (const player of this.state.players) {
      if (player.chips === 0) continue
      const ante = Math.min(this.state.ante, player.chips)
      player.chips -= ante
      player.bet_this_round += ante
      this.state.pot += ante
      if (player.chips === 0) player.is_all_in = true
    }
  }

  private postBlinds(): void {
    const sb = this.state.players[this.state.small_blind_index]
    const bb = this.state.players[this.state.big_blind_index]

    const sbAmount = Math.min(this.state.small_blind, sb.chips)
    sb.chips -= sbAmount
    sb.bet_this_round += sbAmount
    this.state.pot += sbAmount
    if (sb.chips === 0) sb.is_all_in = true

    const bbAmount = Math.min(this.state.big_blind, bb.chips)
    bb.chips -= bbAmount
    bb.bet_this_round += bbAmount
    this.state.pot += bbAmount
    if (bb.chips === 0) bb.is_all_in = true

    this.state.min_bet = this.state.big_blind
    this.state.last_raise_size = this.state.big_blind
  }

  private dealHoleCards(): void {
    const activePlayers = this.state.players.filter((p) => p.chips > 0 || p.is_all_in)
    // Deal 2 cards to each active player
    for (let i = 0; i < 2; i++) {
      for (const player of activePlayers) {
        const card = this.deck.pop()
        if (card) player.hole_cards.push(card)
      }
    }
  }

  private dealCommunityCards(count: number): void {
    // Burn one card
    this.deck.pop()
    for (let i = 0; i < count; i++) {
      const card = this.deck.pop()
      if (card) this.state.community_cards.push(card)
    }
  }

  private getCurrentBet(): number {
    return Math.max(...this.state.players.map((p) => p.bet_this_round))
  }

  private async runBettingRound(): Promise<void> {
    // Reset acted flags
    for (const player of this.state.players) {
      player.has_acted_this_round = false
    }

    const activePlayers = this.getActivePlayers().filter((p) => !p.is_all_in)
    if (activePlayers.length <= 1) return // no action needed

    // For preflop, BB gets option even if no raise
    const isPreflop = this.state.phase === GamePhase.PREFLOP

    let actionCount = 0
    const maxActions = this.state.players.length * 4 // safety limit

    while (actionCount < maxActions) {
      const activeBettors = this.getActivePlayers().filter((p) => !p.is_all_in)
      if (activeBettors.length <= 1) break

      const currentPlayer = this.state.players[this.state.current_player_index]

      if (currentPlayer.is_folded || currentPlayer.is_all_in || currentPlayer.is_sitting_out) {
        this.advanceAction()
        actionCount++
        continue
      }

      const currentBet = this.getCurrentBet()
      const callAmount = currentBet - currentPlayer.bet_this_round

      // Check if betting is complete
      if (currentPlayer.has_acted_this_round && callAmount === 0) {
        // Check if we're back to BB in preflop without a raise
        break
      }

      // Request action
      const validActions = getValidActions(currentPlayer.chips, currentBet, currentPlayer.bet_this_round)

      this.state.min_bet = currentBet
      this.state.min_raise = currentBet + this.state.last_raise_size

      this.emit('action_required', {
        player_index: this.state.current_player_index,
        valid_actions: validActions,
        time_to_act: ACTION_TIMEOUT_SECONDS,
      })

      const action = await this.waitForAction(currentPlayer.agent_id)
      this.applyAction(this.state.current_player_index, action)

      this.emit('action_taken', {
        agent_id: currentPlayer.agent_id,
        agent_name: currentPlayer.agent_name,
        action: action.action,
        amount: action.amount,
      })

      actionCount++

      // Check if only one player left
      if (this.getActivePlayers().length === 1) break

      this.advanceAction()
    }

    // Collect bets into pot after each round
    this.collectBets()
  }

  private advanceAction(): void {
    const n = this.state.players.length
    let next = (this.state.current_player_index - 1 + n) % n
    let attempts = 0
    while (
      (this.state.players[next].is_folded ||
        this.state.players[next].is_all_in ||
        this.state.players[next].is_sitting_out) &&
      attempts < n
    ) {
      next = (next - 1 + n) % n
      attempts++
    }
    this.state.current_player_index = next
  }

  private applyAction(playerIndex: number, action: AgentAction): void {
    const player = this.state.players[playerIndex]
    const currentBet = this.getCurrentBet()

    switch (action.action) {
      case 'fold':
        player.is_folded = true
        player.has_acted_this_round = true
        break

      case 'check':
        player.has_acted_this_round = true
        break

      case 'call': {
        const callAmount = Math.min(currentBet - player.bet_this_round, player.chips)
        player.chips -= callAmount
        player.bet_this_round += callAmount
        this.state.pot += callAmount
        if (player.chips === 0) player.is_all_in = true
        player.has_acted_this_round = true
        break
      }

      case 'raise': {
        const raiseToAmount = action.amount ?? currentBet + this.state.last_raise_size
        const totalNeeded = raiseToAmount - player.bet_this_round
        const actual = Math.min(totalNeeded, player.chips)

        const raiseSize = raiseToAmount - currentBet
        if (raiseSize > 0) this.state.last_raise_size = raiseSize

        player.chips -= actual
        player.bet_this_round += actual
        this.state.pot += actual
        if (player.chips === 0) player.is_all_in = true
        player.has_acted_this_round = true

        // Reset acted flags for other players (they need to respond to the raise)
        for (let i = 0; i < this.state.players.length; i++) {
          if (i !== playerIndex) {
            this.state.players[i].has_acted_this_round = false
          }
        }
        break
      }
    }
  }

  private collectBets(): void {
    for (const player of this.state.players) {
      player.bet_this_round = 0
    }
  }

  private resolveShowdown(): HandResult {
    const activePlayers = this.getActivePlayers()
    const allPots = this.buildSidePots()

    const potResults: { amount: number; winners: string[] }[] = []
    let allWinners: string[] = []

    if (activePlayers.length === 1) {
      // Everyone else folded
      const winner = activePlayers[0]
      winner.chips += this.state.pot
      potResults.push({ amount: this.state.pot, winners: [winner.agent_id] })
      allWinners = [winner.agent_id]
    } else {
      // Full showdown across all pots
      for (const pot of allPots) {
        const eligiblePlayers = activePlayers.filter((p) =>
          pot.eligible_players.includes(p.agent_id)
        )

        if (eligiblePlayers.length === 0) continue

        const showdownResult = determineWinners(
          eligiblePlayers.map((p) => ({ agent_id: p.agent_id, hole_cards: p.hole_cards })),
          this.state.community_cards
        )

        const splitAmount = Math.floor(pot.amount / showdownResult.winners.length)
        const remainder = pot.amount - splitAmount * showdownResult.winners.length

        for (const winnerId of showdownResult.winners) {
          const winner = this.state.players.find((p) => p.agent_id === winnerId)
          if (winner) winner.chips += splitAmount
        }

        // Give remainder to first winner (leftmost position)
        if (remainder > 0) {
          const firstWinner = this.state.players.find(
            (p) => p.agent_id === showdownResult.winners[0]
          )
          if (firstWinner) firstWinner.chips += remainder
        }

        potResults.push({ amount: pot.amount, winners: showdownResult.winners })
        allWinners.push(...showdownResult.winners)
      }

      allWinners = [...new Set(allWinners)]
    }

    // Find eliminated players (0 chips)
    const eliminated = this.state.players
      .filter((p) => p.chips === 0 && !p.is_sitting_out)
      .map((p) => p.agent_id)

    // Mark eliminated as sitting out
    for (const player of this.state.players) {
      if (player.chips === 0) {
        player.is_sitting_out = true
      }
    }

    return {
      hand_number: this.state.hand_number,
      winners: allWinners,
      pots: potResults,
      eliminated,
    }
  }

  private buildSidePots(): SidePot[] {
    // Use all-in players to build side pots
    const allInAmounts = this.state.players
      .filter((p) => p.is_all_in)
      .map((p) => p.bet_this_round)
      .sort((a, b) => a - b)

    if (allInAmounts.length === 0) {
      return [{ amount: this.state.pot, eligible_players: this.getActivePlayers().map((p) => p.agent_id) }]
    }

    const pots: SidePot[] = []
    let previousLevel = 0
    const allPlayers = this.state.players.filter((p) => !p.is_folded)

    const uniqueLevels = [...new Set(allInAmounts)]

    for (const level of uniqueLevels) {
      const diff = level - previousLevel
      const potAmount = allPlayers.reduce((sum, p) => {
        const contrib = Math.min(Math.max(p.bet_this_round - previousLevel, 0), diff)
        return sum + contrib
      }, 0)

      const eligible = allPlayers
        .filter((p) => p.bet_this_round >= level)
        .map((p) => p.agent_id)

      if (potAmount > 0) pots.push({ amount: potAmount, eligible_players: eligible })
      previousLevel = level
    }

    // Main pot remainder
    const remaining = this.state.pot - pots.reduce((s, p) => s + p.amount, 0)
    if (remaining > 0) {
      const eligible = allPlayers
        .filter((p) => p.bet_this_round >= previousLevel)
        .map((p) => p.agent_id)
      pots.push({ amount: remaining, eligible_players: eligible })
    }

    return pots.length > 0 ? pots : [{ amount: this.state.pot, eligible_players: allPlayers.map((p) => p.agent_id) }]
  }

  // Action queue for async turn management
  private actionResolvers = new Map<string, (action: AgentAction) => void>()

  waitForAction(agentId: string): Promise<AgentAction> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.actionResolvers.delete(agentId)
        resolve({ action: 'fold' }) // auto-fold on timeout
      }, ACTION_TIMEOUT_SECONDS * 1000)

      this.actionResolvers.set(agentId, (action: AgentAction) => {
        clearTimeout(timeout)
        this.actionResolvers.delete(agentId)
        resolve(action)
      })
    })
  }

  submitAction(agentId: string, action: AgentAction): boolean {
    const resolver = this.actionResolvers.get(agentId)
    if (!resolver) return false

    const player = this.state.players.find((p) => p.agent_id === agentId)
    if (!player) return false

    const currentBet = this.getCurrentBet()
    const validation = validateBet(
      action.action,
      action.amount,
      player.chips,
      currentBet,
      player.bet_this_round,
      this.state.last_raise_size
    )

    if (!validation.valid) {
      // Invalid action → fold
      resolver({ action: 'fold' })
      return false
    }

    const correctedAction: AgentAction = {
      action: action.action,
      amount: validation.corrected_amount ?? action.amount,
    }

    resolver(correctedAction)
    return true
  }

  private emit(type: GameEventType, data: Record<string, unknown>): void {
    const event: GameEvent = { type, state: this.getState(), data }
    for (const handler of this.eventHandlers) {
      handler(event)
    }
  }

  destroy(): void {
    if (this.actionTimer) clearTimeout(this.actionTimer)
    this.actionResolvers.clear()
  }
}
