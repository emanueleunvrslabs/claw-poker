import type { Server as HTTPServer } from 'http'
import { Server as IOServer } from 'socket.io'
import { setupAgentNamespace } from './agentHandler'
import { setupSpectatorNamespace } from './spectatorHandler'
import { initTournamentRegistry } from './tournamentRegistry'
import { initDemoBots } from '../demo/demoBotSeeder'

export function setupWebSocket(httpServer: HTTPServer): IOServer {
  const io = new IOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  })

  setupAgentNamespace(io)
  setupSpectatorNamespace(io)

  const registry = initTournamentRegistry(io)

  // Seed tournaments then populate with demo bots
  registry.seedDefaultTournaments()
    .then(() => initDemoBots())
    .catch(console.error)

  return io
}
