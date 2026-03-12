import type { Server as IOServer } from 'socket.io'
import { TournamentManager, agentThinkDelay } from '../engine/tournament'
import {
  getTournamentById,
  getTournamentEntries,
  updateTournamentStatus,
  createTournament,
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
import { demoBotStrategies, seedBotsIntoTournament } from '../demo/demoBotSeeder'

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
    const COUNTDOWN_SECONDS = 30
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

    // Hook tournament events → broadcast to spectators
    manager.on((event) => {
      const room = `tournament:${tournamentId}`
      this.io.to(room).emit('tournament:event', event)
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

      // Auto-create replacement tournament + seed demo bots into it
      if (tournament.is_free) {
        await this.createDefaultTournament(tournament.type, tournament.name).catch(() => {})
      } else {
        await this.createPaidTournament(Number(tournament.buy_in), tournament.type).catch(() => {})
      }
      // Seed bots into the newly created replacement tournament
      const { listTournaments: lt } = await import('../db/queries/tournaments')
      const fresh = await lt({ status: 'registering' })
      const label = !tournament.is_free
        ? (Number(tournament.buy_in) >= 1000
            ? `$${(Number(tournament.buy_in) / 1000).toFixed(Number(tournament.buy_in) % 1000 === 0 ? 0 : 1)}K`
            : `$${Number(tournament.buy_in)}`) + ' Sit & Go'
        : tournament.name
      const replacement = fresh.find((t) => t.name === label && t.current_players === 0)
      if (replacement) {
        seedBotsIntoTournament(replacement.id).catch(console.error)
      }
    }).catch(console.error)
  }

  async createDefaultTournament(
    type: 'sit_n_go' | 'heads_up' | 'mtt',
    name: string
  ): Promise<void> {
    const blindStructure = type === 'heads_up' ? BLIND_STRUCTURE_HEADS_UP : BLIND_STRUCTURE_SIT_N_GO
    const prizeStructure = type === 'heads_up' ? PRIZE_STRUCTURE_HEADS_UP : PRIZE_STRUCTURE_9_PLAYER

    await createTournament({
      name,
      type,
      buy_in: 0,
      rake_percent: 0,
      max_players: type === 'heads_up' ? 2 : 6,
      min_players: type === 'heads_up' ? 2 : 6,
      starting_chips: STARTING_CHIPS,
      blind_structure: blindStructure,
      prize_structure: prizeStructure,
      is_free: true,
      scheduled_at: null,
    })
  }

  async createPaidTournament(buyIn: number, type: 'sit_n_go' | 'heads_up' | 'mtt'): Promise<void> {
    const blindStructure = type === 'heads_up' ? BLIND_STRUCTURE_HEADS_UP : BLIND_STRUCTURE_SIT_N_GO
    const prizeStructure = type === 'heads_up' ? PRIZE_STRUCTURE_HEADS_UP : PRIZE_STRUCTURE_6_PLAYER
    const label = buyIn >= 1000 ? `$${(buyIn / 1000).toFixed(buyIn % 1000 === 0 ? 0 : 1)}K` : `$${buyIn}`
    const name = `${label} Sit & Go`

    await createTournament({
      name,
      type,
      buy_in: buyIn,
      rake_percent: 10,
      max_players: type === 'heads_up' ? 2 : 6,
      min_players: type === 'heads_up' ? 2 : 6,
      starting_chips: 1500,
      blind_structure: blindStructure,
      prize_structure: prizeStructure,
      is_free: false,
      scheduled_at: null,
    })
  }

  async seedDefaultTournaments(): Promise<void> {
    const { listTournaments } = await import('../db/queries/tournaments')
    const existing = await listTournaments({ status: 'registering' })
    const existingNames = new Set(existing.map((t) => t.name))

    // Free tournaments
    const freeTournaments = [
      { name: 'Beginner Freeroll', type: 'sit_n_go' as const },
      { name: 'Free Sit & Go', type: 'sit_n_go' as const },
      { name: 'Heads-Up Duel', type: 'heads_up' as const },
    ]
    for (const d of freeTournaments) {
      if (!existingNames.has(d.name)) {
        await this.createDefaultTournament(d.type, d.name).catch(() => {})
      }
    }

    // Paid tournaments — one per buy-in level
    const BUY_INS = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2500, 5000]
    for (const buyIn of BUY_INS) {
      const label = buyIn >= 1000 ? `$${(buyIn / 1000).toFixed(buyIn % 1000 === 0 ? 0 : 1)}K` : `$${buyIn}`
      const name = `${label} Sit & Go`
      if (!existingNames.has(name)) {
        await this.createPaidTournament(buyIn, 'sit_n_go').catch(() => {})
      }
    }
  }
}
