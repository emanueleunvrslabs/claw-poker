/**
 * One-time cleanup + reseed script.
 *
 * Run on VPS after building:
 *   cd /root/claw-poker/apps/server
 *   node -e "require('./dist/scripts/resetTournaments').main()"
 *
 * Or compile directly with ts-node:
 *   npx ts-node -r tsconfig-paths/register src/scripts/resetTournaments.ts
 */

import { db } from '../db/client'
import { createTournament } from '../db/queries/tournaments'
import {
  BLIND_STRUCTURE_SIT_N_GO,
  BLIND_STRUCTURE_HEADS_UP,
  PRIZE_STRUCTURE_HEADS_UP,
  PRIZE_STRUCTURE_6_PLAYER,
} from '@claw-poker/shared'

const PAID_STARTING_CHIPS: Record<number, number> = {
  5:    2_000,
  10:   3_000,
  25:   5_000,
  50:   10_000,
  100:  15_000,
}

const PAID_BUY_INS = [5, 10, 25, 50, 100]

const SIZES = [
  { maxPlayers: 2, suffix: 'Heads-Up', type: 'heads_up' as const },
  { maxPlayers: 4, suffix: '4-Max',    type: 'sit_n_go' as const },
  { maxPlayers: 6, suffix: '6-Max',    type: 'sit_n_go' as const },
]

export async function main() {
  console.log('[Reset] Starting tournament reset...')

  // 1. Find and delete all bot_demo agents
  const { data: botAgents, error: fetchErr } = await db
    .from('agents')
    .select('id, name')
    .eq('agent_type', 'bot_demo')

  if (fetchErr) {
    console.error('[Reset] Failed to fetch demo bots:', fetchErr)
  } else if (botAgents && botAgents.length > 0) {
    const botIds = botAgents.map((a: any) => a.id)
    console.log(`[Reset] Found ${botAgents.length} demo bots: ${botAgents.map((a: any) => a.name).join(', ')}`)

    // Delete their tournament entries
    const { error: entryErr } = await db
      .from('tournament_entries')
      .delete()
      .in('agent_id', botIds)
    if (entryErr) console.error('[Reset] Error deleting bot entries:', entryErr)
    else console.log('[Reset] Bot tournament entries deleted')

    // Delete the agents
    const { error: agentErr } = await db
      .from('agents')
      .delete()
      .in('id', botIds)
    if (agentErr) console.error('[Reset] Error deleting bot agents:', agentErr)
    else console.log(`[Reset] ${botAgents.length} demo bot agents deleted`)
  } else {
    console.log('[Reset] No demo bots found')
  }

  // 2. Cancel all currently-registering tournaments (clean slate)
  const { data: existing } = await db
    .from('tournaments')
    .select('id, name')
    .eq('status', 'registering')

  if (existing && existing.length > 0) {
    const { error: cancelErr } = await db
      .from('tournaments')
      .update({ status: 'cancelled' })
      .eq('status', 'registering')
    if (cancelErr) console.error('[Reset] Error cancelling tournaments:', cancelErr)
    else console.log(`[Reset] Cancelled ${existing.length} registering tournaments`)
  }

  // 3. Create fresh tournaments: 3 sizes × (1 free + PAID_BUY_INS)
  console.log('[Reset] Creating fresh tournaments...')

  // Free tournaments
  for (const size of SIZES) {
    const blind = size.type === 'heads_up' ? BLIND_STRUCTURE_HEADS_UP : BLIND_STRUCTURE_SIT_N_GO
    const prize = size.type === 'heads_up' ? PRIZE_STRUCTURE_HEADS_UP : PRIZE_STRUCTURE_6_PLAYER
    const name = `Free ${size.suffix}`
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
    })
    console.log(`[Reset]   Created: ${name}`)
  }

  // Paid tournaments
  for (const buyIn of PAID_BUY_INS) {
    const label = buyIn >= 1000 ? `$${buyIn / 1000}K` : `$${buyIn}`
    for (const size of SIZES) {
      const blind = size.type === 'heads_up' ? BLIND_STRUCTURE_HEADS_UP : BLIND_STRUCTURE_SIT_N_GO
      const prize = size.type === 'heads_up' ? PRIZE_STRUCTURE_HEADS_UP : PRIZE_STRUCTURE_6_PLAYER
      const name = `${label} ${size.suffix}`
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
      })
      console.log(`[Reset]   Created: ${name}`)
    }
  }

  console.log('[Reset] Done! All tournaments reset.')
  process.exit(0)
}

main().catch((err) => {
  console.error('[Reset] Fatal error:', err)
  process.exit(1)
})
