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
  PRIZE_STRUCTURE_HEADS_UP,
  STARTING_CHIPS,
  AGENT_MIN_THINK_SECONDS,
  AGENT_MAX_THINK_SECONDS,
} from '@claw-poker/shared'
import type { SpectatorGameView, AgentGameView, GamePhase, ActionType } from '@claw-poker/shared'

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

    const entries = await getTournamentEntries(tournamentId)
    if (entries.length < tournament.min_players) return

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

      // Auto-create replacement free tournament
      if (tournament.is_free) {
        await this.createDefaultTournament(tournament.type, tournament.name).catch(() => {})
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
      max_players: type === 'heads_up' ? 2 : 9,
      min_players: type === 'heads_up' ? 2 : 2,
      starting_chips: STARTING_CHIPS,
      blind_structure: blindStructure,
      prize_structure: prizeStructure,
      is_free: true,
      scheduled_at: null,
    })
  }

  async seedDefaultTournaments(): Promise<void> {
    const { listTournaments } = await import('../db/queries/tournaments')
    const existing = await listTournaments({ status: 'registering' })
    if (existing.length >= 3) return

    const defaults = [
      { name: 'Beginner Freeroll', type: 'sit_n_go' as const },
      { name: 'Free Sit & Go', type: 'sit_n_go' as const },
      { name: 'Heads-Up Duel', type: 'heads_up' as const },
    ]

    for (const d of defaults) {
      const alreadyExists = existing.find((t) => t.name === d.name)
      if (!alreadyExists) {
        await this.createDefaultTournament(d.type, d.name).catch(() => {})
      }
    }
  }
}
