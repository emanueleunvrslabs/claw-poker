import type { AgentGameView, ActionType } from '@claw-poker/shared'

export interface BotStrategy {
  name: string
  emoji: string
  decide(view: AgentGameView): { action: ActionType; amount?: number }
}

// ─── TIGHT BOT ───────────────────────────────────────────────
// Only plays premium hands, folds trash
export const TightBot: BotStrategy = {
  name: 'TightBot',
  emoji: '🦅',
  decide(view) {
    const [c1, c2] = view.your_cards
    const isPremium =
      (c1.rank >= 13 && c2.rank >= 13) || // AA KK QQ
      (c1.rank === 14 && c2.rank >= 10) || // AK AQ AJ AT
      (c2.rank === 14 && c1.rank >= 10) ||
      (c1.rank === c2.rank && c1.rank >= 8) // 88+

    const callAmount = view.current_bet - view.your_bet_this_round
    const potOdds = callAmount / (view.pot + callAmount)

    if (view.phase === 'preflop') {
      if (!isPremium) {
        if (callAmount === 0) return { action: 'check' }
        return { action: 'fold' }
      }
      if (view.valid_actions.includes('raise')) {
        return { action: 'raise', amount: view.current_bet + view.min_raise * 2 }
      }
      return { action: 'call' }
    }

    // Post-flop: play conservatively
    if (callAmount === 0) return { action: 'check' }
    if (potOdds < 0.25 && isPremium) return { action: 'call' }
    if (potOdds < 0.15) return { action: 'call' }
    return { action: 'fold' }
  },
}

// ─── AGGRESSIVE BOT ──────────────────────────────────────────
// Raises frequently, applies pressure
export const AggressiveBot: BotStrategy = {
  name: 'AggressBot',
  emoji: '🐺',
  decide(view) {
    const rand = Math.random()
    const callAmount = view.current_bet - view.your_bet_this_round

    if (view.valid_actions.includes('raise') && rand < 0.55) {
      const raiseSize = view.min_raise + Math.floor(Math.random() * view.min_raise * 2)
      const raiseTo = view.current_bet + raiseSize
      return { action: 'raise', amount: Math.min(raiseTo, view.your_chips + view.your_bet_this_round) }
    }

    if (callAmount === 0) return { action: 'check' }
    if (rand < 0.85) return { action: 'call' }
    return { action: 'fold' }
  },
}

// ─── BLUFF BOT ───────────────────────────────────────────────
// Bluffs constantly, unpredictable
export const BluffBot: BotStrategy = {
  name: 'BluffMaster',
  emoji: '🦊',
  decide(view) {
    const rand = Math.random()
    const callAmount = view.current_bet - view.your_bet_this_round

    // Bluff raise 40% of the time regardless of hand
    if (view.valid_actions.includes('raise') && rand < 0.40) {
      const bigRaise = view.current_bet + view.min_raise * 3
      return { action: 'raise', amount: Math.min(bigRaise, view.your_chips + view.your_bet_this_round) }
    }

    // Fold sometimes (selective bluffer)
    if (callAmount > 0 && rand < 0.25) return { action: 'fold' }
    if (callAmount === 0) return { action: 'check' }
    return { action: 'call' }
  },
}

// ─── CALLING STATION ─────────────────────────────────────────
// Calls almost everything, never raises
export const CallerBot: BotStrategy = {
  name: 'CallerAI',
  emoji: '🐑',
  decide(view) {
    const callAmount = view.current_bet - view.your_bet_this_round
    const rand = Math.random()

    if (callAmount === 0) return { action: 'check' }

    // Fold only if pot odds are terrible
    const potOdds = callAmount / (view.pot + callAmount)
    if (potOdds > 0.6 && rand < 0.3) return { action: 'fold' }

    return { action: 'call' }
  },
}

// ─── RANDOM BOT ──────────────────────────────────────────────
// Completely random valid action
export const RandomBot: BotStrategy = {
  name: 'RandomBot',
  emoji: '🐒',
  decide(view) {
    const actions = view.valid_actions
    const picked = actions[Math.floor(Math.random() * actions.length)]

    if (picked === 'raise') {
      const raiseSize = view.min_raise * (1 + Math.floor(Math.random() * 3))
      const raiseTo = view.current_bet + raiseSize
      return { action: 'raise', amount: Math.min(raiseTo, view.your_chips + view.your_bet_this_round) }
    }

    return { action: picked }
  },
}

// ─── GTO BOT ────────────────────────────────────────────────
// Approximates GTO: bet/raise with strong hands, balanced bluffs
export const GTOBot: BotStrategy = {
  name: 'GTO_Agent',
  emoji: '🦉',
  decide(view) {
    const [c1, c2] = view.your_cards
    const maxRank = Math.max(c1.rank, c2.rank)
    const minRank = Math.min(c1.rank, c2.rank)
    const isPair = c1.rank === c2.rank
    const isSuited = c1.suit === c2.suit
    const gap = maxRank - minRank

    // Hand strength heuristic (0-1)
    let strength = (maxRank - 2) / 12 * 0.5 + (minRank - 2) / 12 * 0.3
    if (isPair) strength += 0.3
    if (isSuited) strength += 0.1
    if (gap <= 1) strength += 0.1
    strength = Math.min(1, strength)

    const callAmount = view.current_bet - view.your_bet_this_round
    const potOdds = callAmount > 0 ? callAmount / (view.pot + callAmount) : 0

    // Strong hand: value bet/raise
    if (strength > 0.7 && view.valid_actions.includes('raise')) {
      const raiseTo = view.current_bet + view.min_raise * Math.ceil(strength * 2)
      return { action: 'raise', amount: Math.min(raiseTo, view.your_chips + view.your_bet_this_round) }
    }

    // Medium hand: call if pot odds justify
    if (strength > 0.4) {
      if (callAmount === 0) return { action: 'check' }
      if (strength > potOdds + 0.1) return { action: 'call' }
    }

    // Bluff 15% of the time with weak hands
    if (Math.random() < 0.15 && view.valid_actions.includes('raise')) {
      const bluffSize = view.current_bet + view.min_raise
      return { action: 'raise', amount: Math.min(bluffSize, view.your_chips + view.your_bet_this_round) }
    }

    if (callAmount === 0) return { action: 'check' }
    return { action: 'fold' }
  },
}

export const ALL_BOTS = [GTOBot, AggressiveBot, TightBot, BluffBot, CallerBot, RandomBot]
