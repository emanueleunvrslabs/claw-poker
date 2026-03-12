/**
 * Autonomous Poker Auto-Join Engine
 * Runs every 3 minutes, registers agents with auto_poker=true into open tournaments
 */

import { readPokerSettings, type AgentPokerSettings } from '../api/routes/poker'
import {
  listTournaments,
  getTournamentById,
  getTournamentEntries,
  addTournamentEntry,
} from '../db/queries/tournaments'
import { getUserById } from '../db/queries/users'
import { createTransaction } from '../db/queries/transactions'
import { db } from '../db/client'
import { getTournamentRegistry } from '../ws/tournamentRegistry'

async function runAutoJoin() {
  const allSettings = readPokerSettings()
  const activeAgents = Object.values(allSettings).filter((s) => s.auto_poker)
  if (activeAgents.length === 0) return

  const openTournaments = await listTournaments({ status: 'registering', limit: 50 })
  if (!openTournaments.length) return

  for (const settings of activeAgents) {
    try {
      const { data: agent, error } = await db
        .from('agents')
        .select('id, name, owner_id')
        .eq('id', settings.agent_id)
        .single()
      if (error || !agent) continue

      const user = await getUserById(agent.owner_id)
      if (!user) continue

      // Find open tournaments within max buy-in that agent can afford
      const eligible = openTournaments.filter((t) => {
        if (t.current_players >= t.max_players) return false
        if (!t.is_free && t.buy_in > settings.auto_poker_max_buyin) return false
        if (!t.is_free && user.balance_usdc < t.buy_in) return false
        return true
      })
      if (!eligible.length) continue

      // Check which ones the agent is NOT already in
      const entryChecks = await Promise.all(
        eligible.map((t) =>
          getTournamentEntries(t.id).then((entries) => ({
            tournament: t,
            alreadyIn: entries.some((e) => e.agent_id === agent.id),
          }))
        )
      )
      const notJoined = entryChecks.filter((x) => !x.alreadyIn).map((x) => x.tournament)
      if (!notJoined.length) continue

      // Pick the tournament with the most players already in (closest to starting)
      const target = notJoined.sort((a, b) => b.current_players - a.current_players)[0]

      // Deduct buy-in if paid tournament
      if (!target.is_free && target.buy_in > 0) {
        const { updateBalance } = await import('../db/queries/users')
        const rake = Number((target.buy_in * (target.rake_percent ?? 10) / 100).toFixed(6))
        const prize = Number((target.buy_in - rake).toFixed(6))
        const newBalance = await updateBalance(user.id, -target.buy_in, 'buy_in').catch(() => null)
        if (newBalance === null) continue

        await createTransaction({
          user_id: user.id,
          type: 'buy_in',
          amount: target.buy_in,
          balance_after: newBalance,
          tournament_id: target.id,
          status: 'confirmed',
        })

        // Update prize pool
        const { data: fresh } = await db
          .from('tournaments')
          .select('prize_pool')
          .eq('id', target.id)
          .single()
        await db
          .from('tournaments')
          .update({ prize_pool: (fresh?.prize_pool ?? 0) + prize })
          .eq('id', target.id)
      }

      await addTournamentEntry({
        tournament_id: target.id,
        agent_id: agent.id,
        user_id: user.id,
        buy_in_paid: target.buy_in,
        registered_by: 'agent',
      })

      console.log(`[AutoPoker] ${agent.name} joined "${target.name}" (buy-in: $${target.buy_in})`)

      // Try to start if enough players
      const updated = await getTournamentById(target.id)
      if (updated && updated.current_players >= updated.min_players) {
        const registry = getTournamentRegistry()
        if (registry) registry.tryStartTournament(target.id).catch(console.error)
      }
    } catch (err) {
      console.error('[AutoPoker] error for agent', settings.agent_id, err)
    }
  }
}

export function startPokerAutoJoin() {
  const INTERVAL_MS = 3 * 60 * 1000 // 3 minutes
  console.log('[AutoPoker] Poker autonomous join engine started')
  setInterval(() => {
    runAutoJoin().catch((e) => console.error('[AutoPoker] run error:', e))
  }, INTERVAL_MS)
}
