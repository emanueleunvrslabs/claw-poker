import type { Server as IOServer, Socket } from 'socket.io'
import { getLastSpectateView } from './tournamentRegistry'

export function setupSpectatorNamespace(io: IOServer): void {
  const spectatorNs = io.of('/spectate')

  // No auth required for spectators
  spectatorNs.on('connection', (socket: Socket) => {
    console.log('[WS] Spectator connected')

    // Spectator joins a tournament room
    socket.on('watch', (tournamentId: string) => {
      socket.join(`spectator:${tournamentId}`)
      socket.emit('joined', { tournament_id: tournamentId })
      // Send last known state immediately so the table doesn't sit on "Waiting for game..."
      const cached = getLastSpectateView(tournamentId)
      if (cached) socket.emit('game:state', cached)
    })

    socket.on('unwatch', (tournamentId: string) => {
      socket.leave(`spectator:${tournamentId}`)
    })

    socket.on('disconnect', () => {
      console.log('[WS] Spectator disconnected')
    })
  })
}

export function broadcastGameState(io: IOServer, tournamentId: string, view: unknown): void {
  io.of('/spectate').to(`spectator:${tournamentId}`).emit('game:state', view)
}

export function broadcastAction(
  io: IOServer,
  tournamentId: string,
  action: { agent_name: string; action: string; amount?: number }
): void {
  io.of('/spectate').to(`spectator:${tournamentId}`).emit('game:action', action)
}

export function broadcastDeal(
  io: IOServer,
  tournamentId: string,
  info: { phase: string; cards?: unknown[] }
): void {
  io.of('/spectate').to(`spectator:${tournamentId}`).emit('game:deal', info)
}

export function broadcastShowdown(
  io: IOServer,
  tournamentId: string,
  result: { winners: { agent_name: string; hand: string; cards: unknown[] }[]; pot: number }
): void {
  io.of('/spectate').to(`spectator:${tournamentId}`).emit('game:showdown', result)
}

export function broadcastElimination(
  io: IOServer,
  tournamentId: string,
  info: { agent_name: string; position: number }
): void {
  io.of('/spectate').to(`spectator:${tournamentId}`).emit('game:eliminate', info)
}
