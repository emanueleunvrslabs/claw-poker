import type { SidePot } from '@claw-poker/shared'

export interface BettingPlayer {
  agent_id: string
  chips: number
  bet_this_round: number
  is_folded: boolean
  is_all_in: boolean
}

export interface PotResult {
  main_pot: number
  side_pots: SidePot[]
  total: number
}

export function calculatePots(players: BettingPlayer[]): PotResult {
  const activePlayers = players.filter((p) => !p.is_folded)
  const bets = players.map((p) => ({ agent_id: p.agent_id, amount: p.bet_this_round, folded: p.is_folded }))

  // Sort by bet amount to find side pot thresholds
  const uniqueBetLevels = [...new Set(bets.filter((b) => !b.folded).map((b) => b.amount))].sort(
    (a, b) => a - b
  )

  if (uniqueBetLevels.length === 0) {
    return { main_pot: 0, side_pots: [], total: 0 }
  }

  const pots: SidePot[] = []
  let previousLevel = 0

  for (const level of uniqueBetLevels) {
    const diff = level - previousLevel
    if (diff === 0) continue

    const potAmount = bets.reduce((sum, b) => {
      const contribution = Math.min(Math.max(b.amount - previousLevel, 0), diff)
      return sum + contribution
    }, 0)

    const eligiblePlayers = activePlayers
      .filter((p) => p.bet_this_round >= level)
      .map((p) => p.agent_id)

    if (potAmount > 0) {
      pots.push({ amount: potAmount, eligible_players: eligiblePlayers })
    }

    previousLevel = level
  }

  const total = pots.reduce((sum, p) => sum + p.amount, 0)
  const main_pot = pots[0]?.amount ?? 0
  const side_pots = pots.slice(1)

  return { main_pot, side_pots, total }
}

export interface BetValidationResult {
  valid: boolean
  error?: string
  corrected_amount?: number // for all-in situations
}

export function validateBet(
  action: 'fold' | 'check' | 'call' | 'raise',
  amount: number | undefined,
  playerChips: number,
  currentBet: number,
  playerBetThisRound: number,
  minRaise: number
): BetValidationResult {
  const callAmount = currentBet - playerBetThisRound

  switch (action) {
    case 'fold':
      return { valid: true }

    case 'check':
      if (callAmount > 0) {
        return { valid: false, error: `Cannot check, must call ${callAmount} or fold` }
      }
      return { valid: true }

    case 'call': {
      if (callAmount === 0) {
        return { valid: true } // treated as check
      }
      if (playerChips <= 0) {
        return { valid: false, error: 'No chips to call' }
      }
      // If player can't fully call, they go all-in for what they have
      const actualCall = Math.min(callAmount, playerChips)
      return { valid: true, corrected_amount: actualCall }
    }

    case 'raise': {
      if (amount === undefined) {
        return { valid: false, error: 'Raise requires an amount' }
      }
      const raiseAmount = amount - currentBet
      if (raiseAmount < minRaise && amount < playerChips + playerBetThisRound) {
        return { valid: false, error: `Min raise is ${minRaise}, got ${raiseAmount}` }
      }
      const totalChipsNeeded = amount - playerBetThisRound
      if (totalChipsNeeded > playerChips) {
        // All-in raise
        const allInAmount = playerChips + playerBetThisRound
        return { valid: true, corrected_amount: allInAmount }
      }
      return { valid: true, corrected_amount: amount }
    }
  }
}

export function getValidActions(
  playerChips: number,
  currentBet: number,
  playerBetThisRound: number
): ('fold' | 'check' | 'call' | 'raise')[] {
  const actions: ('fold' | 'check' | 'call' | 'raise')[] = ['fold']
  const callAmount = currentBet - playerBetThisRound

  if (callAmount === 0) {
    actions.push('check')
  } else {
    actions.push('call')
  }

  if (playerChips > callAmount) {
    actions.push('raise')
  }

  return actions
}
