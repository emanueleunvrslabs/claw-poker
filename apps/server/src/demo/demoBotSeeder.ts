import { upsertUser } from '../db/queries/users'
import { createAgent, getAgentByName } from '../db/queries/agents'
import { listTournaments, getTournamentById, getTournamentEntries, addTournamentEntry, syncTournamentPlayerCount } from '../db/queries/tournaments'
import { ALL_BOTS } from './bots'
import type { BotStrategy } from './bots'

// agentId → BotStrategy — populated once at startup
export const demoBotStrategies = new Map<string, BotStrategy>()

const DEMO_WALLET = '0x0000000000000000000000000000000000000001'
const MAX_BOT_BUY_IN = 500    // only seed bots in tables up to $500

let systemUserId: string | null = null

export async function initDemoBots(): Promise<void> {
  try {
    const systemUser = await upsertUser(DEMO_WALLET)
    systemUserId = systemUser.id

    for (const bot of ALL_BOTS) {
      const agentName = `${bot.emoji} ${bot.name}`
      let agent = await getAgentByName(agentName)
      if (!agent) {
        const { agent: created } = await createAgent({
          name: agentName,
          owner_id: systemUser.id,
          agent_type: 'bot_demo',
        })
        agent = created
      }
      demoBotStrategies.set(agent.id, bot)
      console.log(`[DemoBots] Bot ready: ${agentName} (${agent.id})`)
    }

    await seedBotsIntoRegistering()
    console.log(`[DemoBots] Seeding complete — ${demoBotStrategies.size} bots registered`)
  } catch (err) {
    console.error('[DemoBots] Init failed:', err)
  }
}

export async function seedBotsIntoRegistering(): Promise<void> {
  if (!systemUserId || demoBotStrategies.size === 0) return

  const registering = await listTournaments({ status: 'registering' })
  const botEntries = Array.from(demoBotStrategies.entries())

  for (const tournament of registering) {
    if (!tournament.is_free && tournament.buy_in > MAX_BOT_BUY_IN) continue
    await _fillWithBots(tournament.id, tournament.max_players, tournament.is_free, botEntries)
  }

  // Sync current_players count for all affected tournaments (fixes stale counts)
  for (const tournament of registering) {
    if (!tournament.is_free && tournament.buy_in > MAX_BOT_BUY_IN) continue
    await syncTournamentPlayerCount(tournament.id)
  }
}

export async function seedBotsIntoTournament(tournamentId: string): Promise<void> {
  if (!systemUserId || demoBotStrategies.size === 0) return
  try {
    const tournament = await getTournamentById(tournamentId)
    if (!tournament || tournament.status !== 'registering') return
    if (!tournament.is_free && tournament.buy_in > MAX_BOT_BUY_IN) return
    const botEntries = Array.from(demoBotStrategies.entries())
    await _fillWithBots(tournamentId, tournament.max_players, tournament.is_free, botEntries)
  } catch (err) {
    console.error('[DemoBots] seedBotsIntoTournament error:', err)
  }
}

async function _fillWithBots(
  tournamentId: string,
  maxPlayers: number,
  isFree: boolean,
  botEntries: [string, BotStrategy][],
): Promise<void> {
  if (!systemUserId) return

  const existing = await getTournamentEntries(tournamentId)
  const existingIds = new Set(existing.map((e: any) => e.agent_id))

  // Leave at least 1 slot for a real user
  const target = Math.min(botEntries.length, maxPlayers - 1)
  let added = 0

  for (const [agentId] of botEntries) {
    if (added >= target) break
    if (existingIds.has(agentId)) continue
    if (existing.length + added >= maxPlayers - 1) break

    try {
      await addTournamentEntry({
        tournament_id: tournamentId,
        agent_id: agentId,
        user_id: systemUserId,
        buy_in_paid: 0, // bots don't pay
        registered_by: 'agent',
      })
      added++
    } catch {
      // duplicate or constraint error — skip
    }
  }
}
