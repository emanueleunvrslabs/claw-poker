import type { Tournament, TournamentEntry, BlindLevel } from '@claw-poker/shared'
import { AGENT_MIN_THINK_SECONDS, AGENT_MAX_THINK_SECONDS } from '@claw-poker/shared'
import { PokerGame, type GamePlayer, type HandResult } from './game'
import { getCurrentBlindState } from './blinds'

export interface TournamentPlayer {
  agent_id: string
  agent_name: string
  chips: number
  finish_position?: number
  is_eliminated: boolean
}

export type TournamentEventType =
  | 'tournament_start'
  | 'hand_start'
  | 'hand_end'
  | 'player_eliminated'
  | 'blind_level_up'
  | 'tournament_end'

export interface TournamentEvent {
  type: TournamentEventType
  tournament_id: string
  data: Record<string, unknown>
}

export type TournamentEventHandler = (event: TournamentEvent) => void

export class TournamentManager {
  private tournament: Tournament
  private players: TournamentPlayer[]
  private blindStructure: BlindLevel[]
  private startedAt: Date | null = null
  private currentGame: PokerGame | null = null
  private handCount = 0
  private eventHandlers: TournamentEventHandler[] = []
  private isRunning = false

  constructor(tournament: Tournament, blindStructure: BlindLevel[]) {
    this.tournament = tournament
    this.blindStructure = blindStructure
    this.players = []
  }

  on(handler: TournamentEventHandler): void {
    this.eventHandlers.push(handler)
  }

  addPlayer(agentId: string, agentName: string): void {
    if (this.players.find((p) => p.agent_id === agentId)) return
    this.players.push({
      agent_id: agentId,
      agent_name: agentName,
      chips: this.tournament.starting_chips,
      is_eliminated: false,
    })
  }

  getPlayers(): TournamentPlayer[] {
    return [...this.players]
  }

  getActivePlayers(): TournamentPlayer[] {
    return this.players.filter((p) => !p.is_eliminated)
  }

  getCurrentGame(): PokerGame | null {
    return this.currentGame
  }

  submitAction(agentId: string, action: { action: string; amount?: number }): boolean {
    if (!this.currentGame) return false
    return this.currentGame.submitAction(agentId, action as Parameters<PokerGame['submitAction']>[1])
  }

  async start(): Promise<TournamentEntry[]> {
    if (this.players.length < this.tournament.min_players) {
      throw new Error(`Need at least ${this.tournament.min_players} players`)
    }

    this.isRunning = true
    this.startedAt = new Date()

    this.emit('tournament_start', {
      tournament_id: this.tournament.id,
      players: this.players.map((p) => ({ agent_id: p.agent_id, agent_name: p.agent_name, chips: p.chips })),
    })

    while (this.getActivePlayers().length > 1) {
      await this.playHand()

      // Small pause between hands for readability
      await sleep(2000)
    }

    this.isRunning = false
    return this.buildResults()
  }

  private async playHand(): Promise<void> {
    if (!this.startedAt) return

    const active = this.getActivePlayers()
    if (active.length < 2) return

    // Get current blinds
    const blindState = getCurrentBlindState(this.blindStructure, this.startedAt)

    const prevLevel = this.blindStructure.find((b) => b.level === blindState.current_level - 1)
    const curLevel = this.blindStructure.find((b) => b.level === blindState.current_level)

    if (curLevel && prevLevel && curLevel.level !== prevLevel.level) {
      this.emit('blind_level_up', {
        level: blindState.current_level,
        small_blind: blindState.small_blind,
        big_blind: blindState.big_blind,
        ante: blindState.ante,
      })
    }

    // Build game players from active tournament players
    const gamePlayers: GamePlayer[] = active.map((p, idx) => ({
      agent_id: p.agent_id,
      agent_name: p.agent_name,
      seat: idx,
      chips: p.chips,
    }))

    this.currentGame = new PokerGame(
      `${this.tournament.id}-t${++this.handCount}`,
      this.tournament.id,
      gamePlayers,
      blindState.small_blind,
      blindState.big_blind,
      blindState.ante
    )

    // Intercept action_required to enforce think delay for agents
    this.currentGame.on((event) => {
      if (event.type === 'action_required') {
        // The think delay is enforced by wrapping submitAction — agents must wait 3-15s
        // This is handled in the WebSocket layer
      }
      // Forward all game events to tournament handlers
      this.emit('hand_start', { hand_number: this.handCount, state: event.state })
    })

    this.emit('hand_start', {
      hand_number: this.handCount,
      blind_level: blindState.current_level,
      small_blind: blindState.small_blind,
      big_blind: blindState.big_blind,
    })

    let result: HandResult
    try {
      result = await this.currentGame.startHand()
    } finally {
      this.currentGame.destroy()
      this.currentGame = null
    }

    // Chip counts are tracked via eliminated list in HandResult

    // Handle eliminations
    const eliminationPosition = this.getActivePlayers().length

    for (const eliminatedId of result.eliminated) {
      const player = this.players.find((p) => p.agent_id === eliminatedId)
      if (player && !player.is_eliminated) {
        player.is_eliminated = true
        player.chips = 0
        player.finish_position = eliminationPosition

        this.emit('player_eliminated', {
          agent_id: eliminatedId,
          position: eliminationPosition,
        })
      }
    }

    this.emit('hand_end', {
      hand_number: this.handCount,
      winners: result.winners,
      pots: result.pots,
      players_remaining: this.getActivePlayers().length,
    })
  }

  private buildResults(): TournamentEntry[] {
    const active = this.getActivePlayers()
    if (active.length === 1) {
      active[0].finish_position = 1
    }

    return this.players.map((p) => ({
      id: '',
      tournament_id: this.tournament.id,
      agent_id: p.agent_id,
      agent_name: p.agent_name,
      user_id: '',
      finish_position: p.finish_position ?? 1,
      prize_won: 0, // calculated by caller based on prize structure
      registered_by: 'agent' as const,
    }))
  }

  private emit(type: TournamentEventType, data: Record<string, unknown>): void {
    const event: TournamentEvent = { type, tournament_id: this.tournament.id, data }
    for (const handler of this.eventHandlers) {
      handler(event)
    }
  }

  stop(): void {
    this.isRunning = false
    this.currentGame?.destroy()
  }
}

// Enforce agent think delay: 3-15 seconds random
export function agentThinkDelay(): Promise<void> {
  const ms =
    (AGENT_MIN_THINK_SECONDS + Math.random() * (AGENT_MAX_THINK_SECONDS - AGENT_MIN_THINK_SECONDS)) * 1000
  return sleep(ms)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
