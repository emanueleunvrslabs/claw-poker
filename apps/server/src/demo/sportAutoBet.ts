/**
 * Autonomous Sport Betting Engine
 * Runs every 5 minutes, places bets for agents with auto_sport_bet = true
 */

import { readSettings, readBets, writeBets, MOCK_EVENTS, type SportBet, type AgentSportSettings } from '../api/routes/sport'
import { updateBalance, getUserById } from '../db/queries/users'
import { db } from '../db/client'

function pickEvents(strategy: AgentSportSettings['auto_sport_strategy']) {
  const candidates = MOCK_EVENTS.filter((ev) => {
    const maxOdds = Math.max(...Object.values(ev.odds).filter((o) => o > 0))
    switch (strategy) {
      case 'value':      return maxOdds > 2.5
      case 'safe':       return maxOdds >= 1.3 && maxOdds <= 1.8
      case 'aggressive': return maxOdds > 4.0
    }
  })
  // Pick up to 2 random events
  const shuffled = candidates.sort(() => Math.random() - 0.5)
  return shuffled.slice(0, 2)
}

function bestSelection(ev: typeof MOCK_EVENTS[0], strategy: AgentSportSettings['auto_sport_strategy']): { sel: 'home' | 'draw' | 'away'; odds: number } | null {
  const entries = (['home', 'draw', 'away'] as const)
    .map((sel) => ({ sel, odds: ev.odds[sel] }))
    .filter((x) => x.odds > 0)

  if (entries.length === 0) return null

  switch (strategy) {
    case 'value':      return entries.sort((a, b) => b.odds - a.odds)[0]
    case 'safe':       return entries.sort((a, b) => a.odds - b.odds)[0]
    case 'aggressive': return entries.sort((a, b) => b.odds - a.odds)[0]
  }
}

async function runAutoBet() {
  const allSettings = readSettings()
  const activeAgents = Object.values(allSettings).filter((s) => s.auto_sport_bet)
  if (activeAgents.length === 0) return

  const bets = readBets()
  let changed = false

  for (const settings of activeAgents) {
    try {
      // Get agent from DB
      const { data: agent, error } = await db.from('agents').select('id, name, owner_id').eq('id', settings.agent_id).single()
      if (error || !agent) continue

      const user = await getUserById(agent.owner_id)
      if (!user || user.balance_usdc < settings.auto_sport_max_stake) continue

      const events = pickEvents(settings.auto_sport_strategy)
      for (const ev of events) {
        // Skip if already has a pending bet on this event
        const alreadyBet = bets.some((b) => b.agent_id === settings.agent_id && b.event_id === ev.id && b.status === 'pending')
        if (alreadyBet) continue

        const best = bestSelection(ev, settings.auto_sport_strategy)
        if (!best) continue

        const stake = settings.auto_sport_max_stake
        const newBalance = await updateBalance(user.id, -stake, 'buy_in').catch(() => null)
        if (newBalance === null) continue

        const bet: SportBet = {
          id: `sb_auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          agent_id: settings.agent_id,
          agent_name: agent.name,
          user_id: user.id,
          event_id: ev.id,
          event_name: `${ev.home} vs ${ev.away}`,
          sport: ev.sport,
          selection: best.sel,
          selection_label: best.sel === 'home' ? ev.home : best.sel === 'away' ? ev.away : 'Draw',
          odds: best.odds,
          stake,
          potential_win: Number((stake * best.odds).toFixed(2)),
          status: 'pending',
          placed_at: new Date().toISOString(),
        }

        bets.push(bet)
        changed = true
        console.log(`[AutoBet] ${agent.name} bet $${stake} on ${bet.event_name} → ${bet.selection_label} @ ${best.odds}`)
      }
    } catch (err) {
      console.error('[AutoBet] error for agent', settings.agent_id, err)
    }
  }

  if (changed) writeBets(bets)
}

export function startSportAutoBet() {
  const INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
  console.log('[AutoBet] Sport autonomous betting engine started')
  setInterval(() => {
    runAutoBet().catch((e) => console.error('[AutoBet] run error:', e))
  }, INTERVAL_MS)
}
