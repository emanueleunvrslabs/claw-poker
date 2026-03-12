import type { Server as IOServer, Socket } from 'socket.io'
import { z } from 'zod'
import { verifyApiKey } from '../db/queries/agents'
import { getTournamentRegistry } from './tournamentRegistry'
import { AGENT_MIN_THINK_SECONDS, AGENT_MAX_THINK_SECONDS } from '@claw-poker/shared'

const actionSchema = z.object({
  action: z.enum(['fold', 'check', 'call', 'raise', 'all_in']),
  amount: z.number().positive().max(10_000_000).optional(),
  tournament_id: z.string().optional(),
})

// Track which tournament each agent is in
const agentTournamentMap = new Map<string, string>() // agentId → tournamentId

// Track think-delay start times: agentId → timestamp when turn started
const turnStartTimes = new Map<string, number>()

export function setupAgentNamespace(io: IOServer): void {
  const agentNs = io.of('/agent')

  agentNs.use(async (socket, next) => {
    const token = socket.handshake.auth.token ?? socket.handshake.query.token
    if (!token) return next(new Error('Missing token'))

    const agent = await verifyApiKey(String(token))
    if (!agent) return next(new Error('Invalid token'))

    socket.data.agent = agent
    next()
  })

  agentNs.on('connection', (socket: Socket) => {
    const agent = socket.data.agent
    console.log(`[WS] Agent connected: ${agent.name}`)

    // Join personal room for targeted messages
    socket.join(`agent:${agent.id}`)

    // Agent sends action
    socket.on('action', (rawPayload: unknown) => {
      const parsed = actionSchema.safeParse(rawPayload)
      if (!parsed.success) {
        socket.emit('error', 'Invalid action payload')
        return
      }
      const payload = parsed.data
      const tournamentId = payload.tournament_id ?? agentTournamentMap.get(agent.id)
      if (!tournamentId) {
        socket.emit('error', 'Not in a tournament')
        return
      }
      // Verify agent is actually registered in this tournament
      if (!agentTournamentMap.has(agent.id) && payload.tournament_id) {
        socket.emit('error', 'Not registered in this tournament')
        return
      }

      // Enforce minimum think delay (3s)
      const turnStart = turnStartTimes.get(agent.id) ?? 0
      const elapsed = (Date.now() - turnStart) / 1000
      const minDelay = AGENT_MIN_THINK_SECONDS

      const submitAction = () => {
        const registry = getTournamentRegistry()
        if (!registry) return
        const ok = registry.submitAction(tournamentId, agent.id, {
          action: payload.action,
          amount: payload.amount,
        })
        if (!ok) {
          socket.emit('error', 'Not your turn')
        }
      }

      if (elapsed < minDelay) {
        // Enforce minimum delay
        setTimeout(submitAction, (minDelay - elapsed) * 1000)
      } else {
        submitAction()
      }
    })

    // Agent joins a tournament room for game state updates
    socket.on('join_tournament', (tournamentId: string) => {
      socket.join(`tournament:${tournamentId}`)
      agentTournamentMap.set(agent.id, tournamentId)
    })

    socket.on('disconnect', () => {
      console.log(`[WS] Agent disconnected: ${agent.name}`)
      agentTournamentMap.delete(agent.id)
      turnStartTimes.delete(agent.id)
    })
  })

  // Export function to notify agent it's their turn (called by game engine via registry)
  // We expose this via io rooms — each agent has a room `agent:<id>`
}

export function notifyAgentTurn(io: IOServer, agentId: string, view: unknown): void {
  turnStartTimes.set(agentId, Date.now())
  io.of('/agent').to(`agent:${agentId}`).emit('game:your_turn', view)
}

export function notifyAgentGameState(io: IOServer, agentId: string, view: unknown): void {
  io.of('/agent').to(`agent:${agentId}`).emit('game:state', view)
}
