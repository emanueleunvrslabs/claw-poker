import type { Tournament, TournamentEntry, BlindLevel, AgentGameView, ActionType, GamePhase } from '@claw-poker/shared'
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
  private botHandlers = new Map<string, (view: AgentGameView) => { action: ActionType; amount?: number }>()
  private isRunning = false

  constructor(tournament: Tournament, blindStructure: BlindLevel[]) {
    this.tournament = tournament
    this.blindStructure = blindStructure
    this.players = []
  }

  on(handler: TournamentEventHandler): void {
    this.eventHandlers.push(handler)
  }

  registerBotHandler(
    agentId: string,
    handler: (view: AgentGameView) => { action: ActionType; amount?: number },
  ): void {
    this.botHandlers.set(agentId, handler)
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

    // Hook game events: auto-play demo bots + forward state to tournament handlers
    this.currentGame.on((event) => {
      if (event.type === 'action_required') {
        const playerIndex = event.data?.player_index as number
        const gs = event.state
        const currentPlayer = gs?.players?.[playerIndex]
        if (currentPlayer) {
          const botHandler = this.botHandlers.get(currentPlayer.agent_id)
          if (botHandler) {
            const view: AgentGameView = {
              tournament_id: this.tournament.id,
              table_id: `${this.tournament.id}-t${this.handCount}`,
              hand_number: gs.hand_number ?? this.handCount,
              phase: gs.phase as GamePhase,
              your_cards: currentPlayer.hole_cards ?? [],
              community_cards: gs.community_cards ?? [],
              pot: gs.pot ?? 0,
              side_pots: gs.side_pots ?? [],
              your_chips: currentPlayer.chips,
              your_bet_this_round: currentPlayer.bet_this_round ?? 0,
              current_bet: Math.max(0, ...gs.players.map((p: any) => p.bet_this_round ?? 0)),
              min_raise: gs.last_raise_size ?? 0,
              players: gs.players.map((p: any, idx: number) => ({
                agent_id: p.agent_id,
                agent_name: p.agent_name,
                seat: p.seat ?? idx,
                chips: p.chips,
                bet_this_round: p.bet_this_round ?? 0,
                is_folded: p.is_folded ?? false,
                is_all_in: p.is_all_in ?? false,
                is_dealer: p.is_dealer ?? false,
                is_current_turn: idx === playerIndex,
              })),
              your_position: playerIndex,
              dealer_position: gs.dealer_index ?? 0,
              time_to_act: 15,
              valid_actions: (event.data?.valid_actions as ActionType[]) ?? ['fold', 'call'],
            }
            const thinkMs =
              (AGENT_MIN_THINK_SECONDS + Math.random() * (AGENT_MAX_THINK_SECONDS - AGENT_MIN_THINK_SECONDS)) * 1000
            const game = this.currentGame
            setTimeout(() => {
              if (!game) return
              const decision = botHandler(view)
              game.submitAction(currentPlayer.agent_id, decision)
            }, thinkMs)
          }
        }
      }
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
