import type { Server as HTTPServer } from 'http'
import { Server as IOServer } from 'socket.io'
import { setupAgentNamespace } from './agentHandler'
import { setupSpectatorNamespace } from './spectatorHandler'
import { initTournamentRegistry } from './tournamentRegistry'

export function setupWebSocket(httpServer: HTTPServer): IOServer {
  const isProd = process.env.NODE_ENV === 'production'
  const wsOrigin = isProd
    ? [
        'https://squidcasino.unvrslabs.dev',
        'https://www.squidcasino.unvrslabs.dev',
        process.env.FRONTEND_URL,
      ].filter(Boolean) as string[]
    : '*'

  const io = new IOServer(httpServer, {
    cors: {
      origin: wsOrigin,
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  })

  setupAgentNamespace(io)
  setupSpectatorNamespace(io)

  const registry = initTournamentRegistry(io)

  // Seed default tournaments on startup
  registry.seedDefaultTournaments().catch(console.error)

  return io
}
