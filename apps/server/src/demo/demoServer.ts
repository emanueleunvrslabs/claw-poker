import express from 'express'
import { createServer } from 'http'
import cors from 'cors'
import { Server as IOServer } from 'socket.io'
import { PokerGame, type GamePlayer, type GameEvent } from '../engine/game'
import { getCurrentBlindState } from '../engine/blinds'
import {
  BLIND_STRUCTURE_SIT_N_GO,
  STARTING_CHIPS,
  AGENT_MIN_THINK_SECONDS,
  AGENT_MAX_THINK_SECONDS,
} from '@claw-poker/shared'
import type { SpectatorGameView, AgentGameView, GamePhase, ActionType } from '@claw-poker/shared'
import { ALL_BOTS, type BotStrategy } from './bots'

const PORT = 3333

// ─── Express + Socket.io ─────────────────────────────────────
const app = express()
app.use(cors({ origin: '*' }))
app.use(express.json())

const httpServer = createServer(app)
const io = new IOServer(httpServer, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
})

// REST: list current state
app.get('/demo/state', (_req, res) => {
  res.json(currentState)
})

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', mode: 'demo' })
})

// ─── Demo State ───────────────────────────────────────────────
interface DemoState {
  tournament_id: string
  hand_number: number
  phase: string
  community_cards: unknown[]
  pot: number
  players: {
    agent_id: string
    agent_name: string
    emoji: string
    chips: number
    bet_this_round: number
    hole_cards: unknown[]
    is_folded: boolean
    is_all_in: boolean
    is_dealer: boolean
    is_small_blind: boolean
    is_big_blind: boolean
    is_current_turn: boolean
    time_remaining: number
  }[]
  actions: { agent_name: string; action: string; amount?: number; timestamp: string }[]
  blind_level: number
  small_blind: number
  big_blind: number
  ante: number
  next_level_in: number
  players_remaining: number
  total_players: number
  status: 'playing' | 'showdown' | 'between_hands'
  last_winners?: { agent_name: string; hand_name?: string; amount: number }[]
}

let currentState: DemoState = {
  tournament_id: 'demo-1',
  hand_number: 0,
  phase: 'waiting',
  community_cards: [],
  pot: 0,
  players: [],
  actions: [],
  blind_level: 1,
  small_blind: 10,
  big_blind: 20,
  ante: 0,
  next_level_in: 300,
  players_remaining: 6,
  total_players: 6,
  status: 'between_hands',
  last_winners: [],
}

const actionHistory: DemoState['actions'] = []

// ─── Spectator namespace ──────────────────────────────────────
const spectatorNs = io.of('/spectate')
spectatorNs.on('connection', (socket) => {
  console.log('[DEMO] Spectator connected')
  // Send current state immediately
  socket.emit('game:state', currentState)
  socket.on('watch', () => {
    socket.emit('game:state', currentState)
  })
})

function broadcast(event: string, data: unknown) {
  spectatorNs.emit(event, data)
}

function broadcastState() {
  broadcast('game:state', currentState)
}

// ─── Bot players setup ────────────────────────────────────────
const DEMO_PLAYERS = ALL_BOTS.map((bot, i) => ({
  agent_id: `bot_${i}`,
  agent_name: `${bot.emoji} ${bot.name}`,
  emoji: bot.emoji,
  strategy: bot,
  chips: STARTING_CHIPS,
  seat: i,
}))

// ─── Main game loop ───────────────────────────────────────────
async function runDemoLoop() {
  let handCount = 0
  let tournamentStarted = new Date()
  let lastBlindsLevel = 1

  console.log('[DEMO] Starting demo game loop with', DEMO_PLAYERS.length, 'bots')

  while (true) {
    const activePlayers = DEMO_PLAYERS.filter((p) => p.chips > 0)

    if (activePlayers.length < 2) {
      // Tournament over — reset
      console.log('[DEMO] Tournament over, resetting...')
      for (const p of DEMO_PLAYERS) p.chips = STARTING_CHIPS
      tournamentStarted = new Date()
      handCount = 0
      lastBlindsLevel = 1
      actionHistory.length = 0

      currentState.status = 'between_hands'
      currentState.last_winners = []
      currentState.hand_number = 0
      broadcastState()
      await sleep(3000)
      continue
    }

    // Get current blinds
    const blindState = getCurrentBlindState(BLIND_STRUCTURE_SIT_N_GO, tournamentStarted)
    if (blindState.current_level !== lastBlindsLevel) {
      lastBlindsLevel = blindState.current_level
      broadcast('tournament:event', {
        type: 'blind_level_up',
        level: blindState.current_level,
        small_blind: blindState.small_blind,
        big_blind: blindState.big_blind,
      })
    }

    // Build game players
    const gamePlayers: GamePlayer[] = activePlayers.map((p) => ({
      agent_id: p.agent_id,
      agent_name: p.agent_name,
      seat: p.seat,
      chips: p.chips,
    }))

    const game = new PokerGame(
      `demo-table-1`,
      'demo-1',
      gamePlayers,
      blindState.small_blind,
      blindState.big_blind,
      blindState.ante
    )

    handCount++
    currentState.hand_number = handCount
    currentState.phase = 'preflop'
    currentState.actions = []
    currentState.status = 'playing'
    currentState.last_winners = []
    currentState.blind_level = blindState.current_level
    currentState.small_blind = blindState.small_blind
    currentState.big_blind = blindState.big_blind
    currentState.ante = blindState.ante
    currentState.next_level_in = blindState.seconds_until_next_level
    currentState.players_remaining = activePlayers.length
    currentState.total_players = DEMO_PLAYERS.length

    // Listen to game events and broadcast
    game.on((event: GameEvent) => {
      syncStateFromGame(game, event)

      if (event.type === 'action_taken') {
        const d = event.data as { agent_name: string; action: string; amount?: number }
        const entry = {
          agent_name: d.agent_name,
          action: d.action,
          amount: d.amount,
          timestamp: new Date().toLocaleTimeString('it-IT'),
        }
        actionHistory.unshift(entry)
        if (actionHistory.length > 30) actionHistory.pop()
        currentState.actions = actionHistory.slice(0, 20)
        broadcast('game:action', entry)
      }

      if (event.type === 'phase_change') {
        broadcast('game:deal', { phase: event.state.phase, cards: event.state.community_cards })
      }

      broadcastState()
    })

    // Wire bots to respond to action_required
    game.on((event: GameEvent) => {
      if (event.type !== 'action_required') return

      const playerIndex = event.data?.player_index as number
      const gameState = event.state
      const currentPlayer = gameState.players[playerIndex]
      if (!currentPlayer) return

      const botPlayer = DEMO_PLAYERS.find((p) => p.agent_id === currentPlayer.agent_id)
      if (!botPlayer) return

      // Build agent view for the bot
      const agentView: AgentGameView = {
        tournament_id: 'demo-1',
        table_id: 'demo-table-1',
        hand_number: gameState.hand_number,
        phase: gameState.phase as GamePhase,
        your_cards: currentPlayer.hole_cards,
        community_cards: gameState.community_cards,
        pot: gameState.pot,
        side_pots: gameState.side_pots,
        your_chips: currentPlayer.chips,
        your_bet_this_round: currentPlayer.bet_this_round,
        current_bet: Math.max(...gameState.players.map((p) => p.bet_this_round)),
        min_raise: gameState.last_raise_size,
        players: gameState.players.map((p, idx) => ({
          agent_id: p.agent_id,
          agent_name: p.agent_name,
          seat: p.seat,
          chips: p.chips,
          bet_this_round: p.bet_this_round,
          is_folded: p.is_folded,
          is_all_in: p.is_all_in,
          is_dealer: p.is_dealer,
          is_current_turn: idx === playerIndex,
        })),
        your_position: playerIndex,
        dealer_position: gameState.dealer_index,
        time_to_act: 15,
        valid_actions: event.data?.valid_actions as ActionType[] ?? ['fold', 'call'],
      }

      // Think delay: 3-15s random
      const thinkMs =
        (AGENT_MIN_THINK_SECONDS + Math.random() * (AGENT_MAX_THINK_SECONDS - AGENT_MIN_THINK_SECONDS)) * 1000

      // Update timer for spectators
      let remaining = 15
      const timerInterval = setInterval(() => {
        remaining--
        const p = currentState.players.find((sp) => sp.agent_id === currentPlayer.agent_id)
        if (p) {
          p.is_current_turn = true
          p.time_remaining = remaining
          broadcastState()
        }
      }, 1000)

      setTimeout(() => {
        clearInterval(timerInterval)
        const decision = botPlayer.strategy.decide(agentView)
        game.submitAction(currentPlayer.agent_id, decision)
      }, thinkMs)
    })

    // Run the hand
    let result
    try {
      result = await game.startHand()
    } catch (e) {
      console.error('[DEMO] Hand error:', e)
      game.destroy()
      await sleep(1000)
      continue
    }

    // Update chip counts from game state
    const finalState = game.getState()
    for (const fp of finalState.players) {
      const bot = DEMO_PLAYERS.find((p) => p.agent_id === fp.agent_id)
      if (bot) bot.chips = fp.chips
    }

    // Showdown broadcast
    currentState.status = 'showdown'
    currentState.last_winners = result.winners.map((wId) => {
      const bot = DEMO_PLAYERS.find((p) => p.agent_id === wId)
      const pot = result.pots.find((p) => p.winners.includes(wId))
      return {
        agent_name: bot?.agent_name ?? wId,
        amount: pot ? Math.floor(pot.amount / (pot.winners.length)) : 0,
      }
    })

    broadcast('game:showdown', {
      winners: currentState.last_winners,
      pot: result.pots.reduce((s, p) => s + p.amount, 0),
    })
    broadcastState()

    // Handle eliminations
    for (const elimId of result.eliminated) {
      const bot = DEMO_PLAYERS.find((p) => p.agent_id === elimId)
      if (bot) {
        const position = DEMO_PLAYERS.filter((p) => p.chips > 0).length + 1
        console.log(`[DEMO] ${bot.agent_name} eliminated in position ${position}`)
        broadcast('game:eliminate', { agent_name: bot.agent_name, position })
      }
    }

    game.destroy()

    // Pause between hands
    currentState.status = 'between_hands'
    broadcastState()
    await sleep(3500)
  }
}

// ─── Sync game state → demo state ────────────────────────────
function syncStateFromGame(game: PokerGame, event: GameEvent) {
  const s = event.state

  currentState.phase = s.phase
  currentState.community_cards = s.community_cards
  currentState.pot = s.pot
  // hand_number is set by the demo loop (handCount), not by the per-hand game instance

  // Build a map of active players from the game state
  const activeMap = new Map(s.players.map((p, idx) => [p.agent_id, { p, idx }]))

  // Always include ALL 6 bots so every seat is always visible
  currentState.players = DEMO_PLAYERS.map((bot) => {
    const active = activeMap.get(bot.agent_id)
    if (active) {
      const { p, idx } = active
      return {
        agent_id: p.agent_id,
        agent_name: p.agent_name,
        emoji: bot.emoji,
        chips: p.chips,
        bet_this_round: p.bet_this_round,
        hole_cards: p.hole_cards,
        is_folded: p.is_folded,
        is_all_in: p.is_all_in,
        is_dealer: p.is_dealer,
        is_small_blind: p.is_small_blind,
        is_big_blind: p.is_big_blind,
        is_current_turn: idx === s.current_player_index && !p.is_folded && !p.is_all_in,
        time_remaining: 15,
      }
    }
    // Eliminated player — show as OUT with 0 chips
    return {
      agent_id: bot.agent_id,
      agent_name: bot.agent_name,
      emoji: bot.emoji,
      chips: 0,
      bet_this_round: 0,
      hole_cards: [],
      is_folded: true,
      is_all_in: false,
      is_dealer: false,
      is_small_blind: false,
      is_big_blind: false,
      is_current_turn: false,
      time_remaining: 0,
    }
  })
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── Start ────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`\n🃏 CLAW POKER DEMO SERVER`)
  console.log(`   http://localhost:${PORT}`)
  console.log(`   WebSocket: ws://localhost:${PORT}/spectate`)
  console.log(`   6 bots: ${DEMO_PLAYERS.map((p) => p.agent_name).join(' | ')}`)
  console.log(`   Starting game loop...\n`)
  runDemoLoop().catch(console.error)
})

export { io }
