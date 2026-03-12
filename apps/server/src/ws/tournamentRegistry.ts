import type { Server as IOServer } from 'socket.io'
import { TournamentManager, agentThinkDelay } from '../engine/tournament'
import { getCurrentBlindState } from '../engine/blinds'
import {
  getTournamentById,
  getTournamentEntries,
  updateTournamentStatus,
  createTournament,
  type TournamentRow,
} from '../db/queries/tournaments'
import { getAgentById, updateAgentStats } from '../db/queries/agents'
import {
  BLIND_STRUCTURE_SIT_N_GO,
  BLIND_STRUCTURE_HEADS_UP,
  PRIZE_STRUCTURE_9_PLAYER,
  PRIZE_STRUCTURE_6_PLAYER,
  PRIZE_STRUCTURE_HEADS_UP,
  STARTING_CHIPS,
  AGENT_MIN_THINK_SECONDS,
  AGENT_MAX_THINK_SECONDS,
} from '@claw-poker/shared'
import type { SpectatorGameView, AgentGameView, GamePhase, ActionType } from '@claw-poker/shared'
import { demoBotStrategies } from '../demo/demoBotSeeder'
import { notifyAgentTurn } from './agentHandler'

const PAID_STARTING_CHIPS: Record<number, number> = {
  5:    2_000,
  10:   3_000,
  25:   5_000,
  50:   10_000,
  100:  15_000,
  250:  25_000,
  500:  50_000,
  1000: 100_000,
  2500: 100_000,
  5000: 100_000,
}

// Last known spectate view per tournament (for late-joining spectators)
const lastSpectateViews = new Map<string, unknown>()
let globalHandCount = 0

export function getLastSpectateView(tournamentId: string): unknown | undefined {
  return lastSpectateViews.get(tournamentId)
}

let registry: TournamentRegistry | null = null

export function getTournamentRegistry(): TournamentRegistry | null {
  return registry
}

export function initTournamentRegistry(io: IOServer): TournamentRegistry {
  registry = new TournamentRegistry(io)
  return registry
}

export class TournamentRegistry {
  private managers = new Map<string, TournamentManager>()
  private countdowns = new Set<string>() // tournamentIds currently in countdown
  private io: IOServer

  constructor(io: IOServer) {
    this.io = io
  }

  getManager(tournamentId: string): TournamentManager | undefined {
    return this.managers.get(tournamentId)
  }

  submitAction(tournamentId: string, agentId: string, action: { action: string; amount?: number }): boolean {
    const manager = this.managers.get(tournamentId)
    if (!manager) return false
    return manager.submitAction(agentId, action)
  }

  async tryStartTournament(tournamentId: string): Promise<void> {
    const tournament = await getTournamentById(tournamentId)
    if (!tournament || tournament.status !== 'registering') return
    if (tournament.current_players < tournament.min_players) return
    if (this.managers.has(tournamentId)) return // already running
    if (this.countdowns.has(tournamentId)) return // countdown already in progress

    const entries = await getTournamentEntries(tournamentId)
    if (entries.length < tournament.min_players) return

    // Countdown: notify all participants, then wait 30s
    this.countdowns.add(tournamentId)
    const COUNTDOWN_SECONDS = 10
    const room = `tournament:${tournamentId}`
    this.io.to(room).emit('tournament:event', {
      type: 'tournament_countdown',
      tournament_id: tournamentId,
      data: { seconds: COUNTDOWN_SECONDS },
    })
    // Also notify each agent directly
    for (const entry of entries) {
      this.io.to(`agent:${entry.agent_id}`).emit('tournament:countdown', {
        tournament_id: tournamentId,
        seconds: COUNTDOWN_SECONDS,
      })
    }
    await new Promise((resolve) => setTimeout(resolve, COUNTDOWN_SECONDS * 1000))
    this.countdowns.delete(tournamentId)

    // Mark as running
    await updateTournamentStatus(tournamentId, 'running', { started_at: new Date().toISOString() })

    const blindStructure =
      tournament.type === 'heads_up' ? BLIND_STRUCTURE_HEADS_UP : BLIND_STRUCTURE_SIT_N_GO

    const manager = new TournamentManager(
      {
        id: tournament.id,
        name: tournament.name,
        type: tournament.type,
        buy_in: Number(tournament.buy_in),
        rake_percent: Number(tournament.rake_percent),
        prize_pool: Number(tournament.prize_pool),
        max_players: tournament.max_players,
        min_players: tournament.min_players,
        current_players: tournament.current_players,
        status: 'running',
        blind_structure: blindStructure,
        prize_structure: tournament.type === 'heads_up' ? PRIZE_STRUCTURE_HEADS_UP : PRIZE_STRUCTURE_9_PLAYER,
        starting_chips: tournament.starting_chips ?? STARTING_CHIPS,
        is_free: tournament.is_free,
      },
      blindStructure
    )

    for (const entry of entries) {
      const agentName = (entry as unknown as { agents?: { name: string } }).agents?.name ?? entry.agent_id
      manager.addPlayer(entry.agent_id, agentName)
    }

    // Register bot handlers for demo bots
    for (const entry of entries) {
      const strategy = demoBotStrategies.get(entry.agent_id)
      if (strategy) {
        manager.registerBotHandler(entry.agent_id, (view) => strategy.decide(view))
      }
    }

    // Track state for spectator broadcast
    const tournamentStartedAt = new Date()
    const recentActions: SpectatorGameView['actions'] = []
    let lastWinners: { agent_name: string; amount: number }[] = []

    // Hook tournament events → broadcast to spectators
    manager.on((event) => {
      const room = `tournament:${tournamentId}`
      this.io.to(room).emit('tournament:event', event)

      // Notify real agents when it's their turn
      if (event.type === 'agent_action_required') {
        const agentId = event.data.agent_id as string
        const view = event.data.view
        notifyAgentTurn(this.io, agentId, view)
      }

      // Increment global hand counter on new hand start (no state = new hand)
      if (event.type === 'hand_start' && !(event.data as any)?.state) {
        globalHandCount++
      }

      // Track actions
      if (event.type === 'hand_start' && (event.data as any)?.action) {
        const a = (event.data as any).action
        recentActions.unshift({ agent_name: a.agent_name, action: a.action, amount: a.amount, timestamp: new Date().toISOString() })
        if (recentActions.length > 20) recentActions.pop()
      }

      // Capture winners on hand_end
      if (event.type === 'hand_end') {
        const winners = (event.data as any)?.winners
        if (Array.isArray(winners)) {
          lastWinners = winners.map((w: any) => ({ agent_name: w.agent_name, amount: w.amount ?? 0 }))
        }
      } else {
        lastWinners = []
      }

      // Broadcast game state to spectators on every state-bearing event
      const gs = (event.data as any)?.state
      if (gs && Array.isArray(gs.players) && gs.players.length > 0) {
        const blindState = getCurrentBlindState(blindStructure, tournamentStartedAt)
        const activePlayers = manager.getActivePlayers()
        const totalPlayers = manager.getPlayers().length

        const spectateView: SpectatorGameView & { status: string; last_winners?: typeof lastWinners; emoji?: Record<string, string> } = {
          tournament_id: tournamentId,
          table_id: `${tournamentId}-t${globalHandCount}`,
          hand_number: globalHandCount,
          phase: gs.phase,
          community_cards: gs.community_cards ?? [],
          pot: gs.pot ?? 0,
          side_pots: gs.side_pots ?? [],
          players: (gs.players as any[]).map((p: any, idx: number) => ({
            agent_id: p.agent_id,
            agent_name: p.agent_name,
            seat: p.seat ?? idx,
            chips: p.chips,
            bet_this_round: p.bet_this_round ?? 0,
            // Only reveal hole cards at showdown or after fold (game integrity)
            hole_cards: (gs.phase === 'showdown' || p.is_folded) ? (p.hole_cards ?? []) : [],
            is_folded: p.is_folded ?? false,
            is_all_in: p.is_all_in ?? false,
            is_dealer: p.is_dealer ?? false,
            is_small_blind: p.is_small_blind ?? false,
            is_big_blind: p.is_big_blind ?? false,
            is_current_turn: idx === gs.current_player_index,
            time_remaining: idx === gs.current_player_index ? 15 : 0,
          })),
          actions: recentActions,
          blind_level: blindState.current_level,
          small_blind: blindState.small_blind,
          big_blind: blindState.big_blind,
          ante: blindState.ante,
          next_level_in: blindState.seconds_until_next_level,
          players_remaining: activePlayers.length,
          total_players: totalPlayers,
          status: event.type === 'hand_end' ? 'showdown' : 'playing',
          last_winners: event.type === 'hand_end' ? lastWinners : undefined,
        }

        lastSpectateViews.set(tournamentId, spectateView)
        this.io.of('/spectate').to(`spectator:${tournamentId}`).emit('game:state', spectateView)
      }
    })

    this.managers.set(tournamentId, manager)

    // Notify agents
    for (const entry of entries) {
      const agentRoom = `agent:${entry.agent_id}`
      this.io.to(agentRoom).emit('tournament:start', {
        tournament_id: tournamentId,
        starting_chips: tournament.starting_chips ?? STARTING_CHIPS,
      })
    }

    // Run tournament in background
    manager.start().then(async (results) => {
      this.managers.delete(tournamentId)

      // Calculate prizes
      const prizeStructure = tournament.type === 'heads_up' ? PRIZE_STRUCTURE_HEADS_UP : PRIZE_STRUCTURE_9_PLAYER
      const prizePool = Number(tournament.prize_pool)

      for (const result of results) {
        const pos = result.finish_position ?? results.length
        const pct = prizeStructure[String(pos)] ?? 0
        result.prize_won = (prizePool * pct) / 100
      }

      const winner = results.find((r) => r.finish_position === 1)

      await updateTournamentStatus(tournamentId, 'finished', {
        finished_at: new Date().toISOString(),
        winner_id: winner?.agent_id ?? null,
        results: results as unknown as never,
      })

      // Update agent stats
      for (const result of results) {
        await updateAgentStats(result.agent_id, {
          total_tournaments: 1,
          total_wins: result.finish_position === 1 ? 1 : 0,
          total_profit: result.prize_won - Number(tournament.buy_in),
        }).catch(() => {})
      }

      // Notify everyone
      const room = `tournament:${tournamentId}`
      this.io.to(room).emit('tournament:end', results)

      // Auto-create replacement tournament of same buy-in and size
      await this.createReplacementTournament(tournament).catch(console.error)
    }).catch(console.error)
  }

  // Creates a replacement tournament matching the same buy-in and table size
  async createReplacementTournament(tournament: TournamentRow): Promise<void> {
    const buyIn = Number(tournament.buy_in)
    const maxPlayers = tournament.max_players
    const type = tournament.type
    const isFree = tournament.is_free

    const blind = type === 'heads_up' ? BLIND_STRUCTURE_HEADS_UP : BLIND_STRUCTURE_SIT_N_GO
    const prize = type === 'heads_up' ? PRIZE_STRUCTURE_HEADS_UP : PRIZE_STRUCTURE_6_PLAYER

    const label = isFree ? 'Free' : (buyIn >= 1000 ? `$${(buyIn / 1000).toFixed(buyIn % 1000 === 0 ? 0 : 1)}K` : `$${buyIn}`)
    const sizeSuffix = maxPlayers === 2 ? 'Heads-Up' : maxPlayers === 4 ? '4-Max' : '6-Max'
    const name = `${label} ${sizeSuffix}`

    const startingChips = isFree ? 10_000 : (PAID_STARTING_CHIPS[buyIn] ?? 10_000)

    await createTournament({
      name,
      type,
      buy_in: buyIn,
      rake_percent: isFree ? 0 : 10,
      max_players: maxPlayers,
      min_players: 2,
      starting_chips: startingChips,
      blind_structure: blind,
      prize_structure: prize,
      is_free: isFree,
      scheduled_at: null,
    })
    console.log(`[Registry] Replacement tournament created: ${name} (${maxPlayers}P, $${buyIn})`)
  }

  async seedDefaultTournaments(): Promise<void> {
    const { listTournaments } = await import('../db/queries/tournaments')
    const existing = await listTournaments({ status: 'registering' })
    const existingNames = new Set(existing.map((t) => t.name))

    const SIZES = [
      { maxPlayers: 2, suffix: 'Heads-Up', type: 'heads_up' as const },
      { maxPlayers: 4, suffix: '4-Max',    type: 'sit_n_go' as const },
      { maxPlayers: 6, suffix: '6-Max',    type: 'sit_n_go' as const },
    ]

    // Free tournaments
    for (const size of SIZES) {
      const name = `Free ${size.suffix}`
      if (!existingNames.has(name)) {
        const blind = size.type === 'heads_up' ? BLIND_STRUCTURE_HEADS_UP : BLIND_STRUCTURE_SIT_N_GO
        const prize = size.type === 'heads_up' ? PRIZE_STRUCTURE_HEADS_UP : PRIZE_STRUCTURE_6_PLAYER
        await createTournament({
          name,
          type: size.type,
          buy_in: 0,
          rake_percent: 0,
          max_players: size.maxPlayers,
          min_players: 2,
          starting_chips: 10_000,
          blind_structure: blind,
          prize_structure: prize,
          is_free: true,
          scheduled_at: null,
        }).catch(() => {})
      }
    }

    // Paid tournaments — 3 sizes per buy-in level
    const BUY_INS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]
    for (const buyIn of BUY_INS) {
      const label = `$${buyIn}`
      for (const size of SIZES) {
        const name = `${label} ${size.suffix}`
        if (!existingNames.has(name)) {
          const blind = size.type === 'heads_up' ? BLIND_STRUCTURE_HEADS_UP : BLIND_STRUCTURE_SIT_N_GO
          const prize = size.type === 'heads_up' ? PRIZE_STRUCTURE_HEADS_UP : PRIZE_STRUCTURE_6_PLAYER
          const startingChips = PAID_STARTING_CHIPS[buyIn] ?? 5_000
          await createTournament({
            name,
            type: size.type,
            buy_in: buyIn,
            rake_percent: 10,
            max_players: size.maxPlayers,
            min_players: 2,
            starting_chips: startingChips,
            blind_structure: blind,
            prize_structure: prize,
            is_free: false,
            scheduled_at: null,
          }).catch(() => {})
        }
      }
    }
  }
}
