import { Router } from 'express'
import * as fs from 'fs'
import * as path from 'path'
import { z } from 'zod'
import { ethers } from 'ethers'
import { createHash } from 'crypto'
import { authMiddleware } from '../middleware/auth'
import { rateLimit } from '../middleware/rateLimit'
import { updateBalance, getUserById, getUserByWallet } from '../../db/queries/users'
import { getAgentsByOwner } from '../../db/queries/agents'

export const sportRouter = Router()

// ── Persistent storage (file-based) ──────────────────────────────────────────
const DATA_DIR = path.join(process.cwd(), 'data')
const BETS_FILE = path.join(DATA_DIR, 'sport_bets.json')
const SETTINGS_FILE = path.join(DATA_DIR, 'sport_settings.json')

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

export function readBets(): SportBet[] {
  try {
    ensureDataDir()
    if (!fs.existsSync(BETS_FILE)) return []
    return JSON.parse(fs.readFileSync(BETS_FILE, 'utf8'))
  } catch { return [] }
}

export function writeBets(bets: SportBet[]) {
  ensureDataDir()
  fs.writeFileSync(BETS_FILE, JSON.stringify(bets, null, 2))
}

export function readSettings(): Record<string, AgentSportSettings> {
  try {
    ensureDataDir()
    if (!fs.existsSync(SETTINGS_FILE)) return {}
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
  } catch { return {} }
}

export function writeSettings(settings: Record<string, AgentSportSettings>) {
  ensureDataDir()
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
}

// ── Signature replay protection ───────────────────────────────────────────────
const usedSignatures = new Map<string, number>()
function consumeSignature(sig: string): boolean {
  const key = createHash('sha256').update(sig).digest('hex')
  const now = Date.now()
  for (const [k, exp] of usedSignatures) { if (exp < now) usedSignatures.delete(k) }
  if (usedSignatures.has(key)) return false
  usedSignatures.set(key, now + 5 * 60 * 1000)
  return true
}

// Max bet stake: $1000 per bet, min $0.01
const MAX_BET_STAKE = 1000
const MIN_BET_STAKE = 0.01

// ── Types ─────────────────────────────────────────────────────────────────────
export interface SportBet {
  id: string
  agent_id: string
  agent_name: string
  user_id: string
  event_id: string
  event_name: string
  sport: string
  selection: string
  selection_label: string
  odds: number
  stake: number
  potential_win: number
  status: 'pending' | 'won' | 'lost' | 'void'
  placed_at: string
  settled_at?: string
}

export interface AgentSportSettings {
  agent_id: string
  auto_sport_bet: boolean
  auto_sport_max_stake: number
  auto_sport_strategy: 'value' | 'safe' | 'aggressive'
}

// ── Mock Events ───────────────────────────────────────────────────────────────
const now = new Date()
const d = (h: number) => new Date(now.getTime() + h * 3600000).toISOString()

export const MOCK_EVENTS = [
  { id: 'f001', sport: 'football', league: 'Serie A', home: 'Juventus', away: 'Inter Milan', time: d(4), odds: { home: 2.10, draw: 3.40, away: 3.20 } },
  { id: 'f002', sport: 'football', league: 'Champions League', home: 'Real Madrid', away: 'Bayern Munich', time: d(7), odds: { home: 1.85, draw: 3.60, away: 4.20 } },
  { id: 'f003', sport: 'football', league: 'Premier League', home: 'Arsenal', away: 'Chelsea', time: d(26), odds: { home: 2.30, draw: 3.25, away: 3.10 } },
  { id: 'f004', sport: 'football', league: 'La Liga', home: 'Barcelona', away: 'Atletico Madrid', time: d(28), odds: { home: 1.75, draw: 3.50, away: 4.80 } },
  { id: 'f005', sport: 'football', league: 'Serie A', home: 'AC Milan', away: 'Napoli', time: d(52), odds: { home: 2.50, draw: 3.20, away: 2.80 } },
  { id: 'b001', sport: 'basketball', league: 'NBA', home: 'LA Lakers', away: 'Golden State Warriors', time: d(3), odds: { home: 1.95, draw: 0, away: 1.92 } },
  { id: 'b002', sport: 'basketball', league: 'NBA', home: 'Boston Celtics', away: 'Miami Heat', time: d(5), odds: { home: 1.60, draw: 0, away: 2.40 } },
  { id: 'b003', sport: 'basketball', league: 'NBA', home: 'Denver Nuggets', away: 'Phoenix Suns', time: d(29), odds: { home: 1.75, draw: 0, away: 2.10 } },
  { id: 't001', sport: 'tennis', league: 'ATP Masters', home: 'Jannik Sinner', away: 'Carlos Alcaraz', time: d(2), odds: { home: 1.90, draw: 0, away: 1.90 } },
  { id: 't002', sport: 'tennis', league: 'WTA', home: 'Iga Swiatek', away: 'Aryna Sabalenka', time: d(6), odds: { home: 1.65, draw: 0, away: 2.30 } },
  { id: 'n001', sport: 'nfl', league: 'NFL', home: 'Kansas City Chiefs', away: 'San Francisco 49ers', time: d(8), odds: { home: 1.80, draw: 0, away: 2.10 } },
  { id: 'n002', sport: 'nfl', league: 'NFL', home: 'Dallas Cowboys', away: 'Philadelphia Eagles', time: d(32), odds: { home: 2.20, draw: 0, away: 1.75 } },
]

const betSchema = z.object({
  event_id: z.string().min(1).max(20),
  selection: z.enum(['home', 'draw', 'away']),
  stake: z.number().positive().min(MIN_BET_STAKE).max(MAX_BET_STAKE),
})

const walletBetSchema = betSchema.extend({
  signature: z.string(),
  timestamp: z.number().int(),
})

const walletSettingsSchema = z.object({
  auto_sport_bet: z.boolean().optional(),
  auto_sport_max_stake: z.number().positive().min(0.01).max(MAX_BET_STAKE).optional(),
  auto_sport_strategy: z.enum(['value', 'safe', 'aggressive']).optional(),
  signature: z.string(),
  timestamp: z.number().int(),
})

// ── GET /api/sport/events ─────────────────────────────────────────────────────
sportRouter.get('/events', (_req, res) => {
  res.json(MOCK_EVENTS)
})

// ── GET /api/sport/bets — agent API key auth ──────────────────────────────────
sportRouter.get('/bets', authMiddleware, (req, res) => {
  const bets = readBets().filter((b) => b.agent_id === req.agent!.id)
  res.json(bets)
})

// ── POST /api/sport/bets — agent API key auth, 20/min ────────────────────────
sportRouter.post('/bets', authMiddleware, rateLimit(20), async (req, res, next) => {
  try {
    const body = betSchema.parse(req.body)

    const event = MOCK_EVENTS.find((e) => e.id === body.event_id)
    if (!event) { res.status(404).json({ error: 'Event not found' }); return }
    const odds = event.odds[body.selection]
    if (!odds || odds === 0) { res.status(400).json({ error: 'Invalid selection for this event' }); return }

    const agent = req.agent!
    const user = await getUserById(agent.owner_id)
    if (!user) { res.status(404).json({ error: 'User not found' }); return }
    if (user.balance_usdc < body.stake) {
      res.status(400).json({ error: `Insufficient balance: have $${user.balance_usdc.toFixed(2)}, need $${body.stake}` })
      return
    }

    await updateBalance(user.id, -body.stake, 'buy_in')

    const bet: SportBet = {
      id: `sb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      agent_id: agent.id, agent_name: agent.name, user_id: user.id,
      event_id: body.event_id, event_name: `${event.home} vs ${event.away}`, sport: event.sport,
      selection: body.selection,
      selection_label: body.selection === 'home' ? event.home : body.selection === 'away' ? event.away : 'Draw',
      odds, stake: body.stake, potential_win: Number((body.stake * odds).toFixed(2)),
      status: 'pending', placed_at: new Date().toISOString(),
    }

    const bets = readBets()
    bets.push(bet)
    writeBets(bets)
    res.status(201).json(bet)
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: err.flatten().fieldErrors }); return }
    next(err)
  }
})

// ── GET /api/sport/settings — agent API key auth ──────────────────────────────
sportRouter.get('/settings', authMiddleware, (req, res) => {
  const all = readSettings()
  const settings = all[req.agent!.id] ?? {
    agent_id: req.agent!.id,
    auto_sport_bet: false,
    auto_sport_max_stake: 10,
    auto_sport_strategy: 'value' as const,
  }
  res.json(settings)
})

// ── PATCH /api/sport/settings — agent API key auth ───────────────────────────
sportRouter.patch('/settings', authMiddleware, rateLimit(30), (req, res) => {
  try {
    const body = z.object({
      auto_sport_bet: z.boolean().optional(),
      auto_sport_max_stake: z.number().positive().min(0.01).max(MAX_BET_STAKE).optional(),
      auto_sport_strategy: z.enum(['value', 'safe', 'aggressive']).optional(),
    }).parse(req.body)

    const all = readSettings()
    const current = all[req.agent!.id] ?? {
      agent_id: req.agent!.id,
      auto_sport_bet: false,
      auto_sport_max_stake: 10,
      auto_sport_strategy: 'value' as const,
    }

    const updated: AgentSportSettings = {
      ...current,
      ...(body.auto_sport_bet !== undefined && { auto_sport_bet: body.auto_sport_bet }),
      ...(body.auto_sport_max_stake !== undefined && { auto_sport_max_stake: body.auto_sport_max_stake }),
      ...(body.auto_sport_strategy !== undefined && { auto_sport_strategy: body.auto_sport_strategy }),
    }

    all[req.agent!.id] = updated
    writeSettings(all)
    res.json(updated)
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: err.flatten().fieldErrors }); return }
    res.status(500).json({ error: 'Internal error' })
  }
})

// ── GET /api/sport/settings/all — INTERNAL only (demo engine) ────────────────
// Protected by internal secret header
sportRouter.get('/settings/all', (req, res) => {
  const secret = req.headers['x-internal-secret']
  if (!secret || secret !== process.env.INTERNAL_SECRET) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  res.json(readSettings())
})

// ── Wallet-based endpoints — require wallet signature proof ──────────────────

// GET /api/sport/wallet/:wallet/settings — read-only, no auth needed
sportRouter.get('/wallet/:wallet/settings', async (req, res, next) => {
  try {
    const wallet = req.params.wallet.toLowerCase()
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) { res.status(400).json({ error: 'Invalid wallet' }); return }
    const user = await getUserByWallet(wallet)
    if (!user) { res.status(404).json({ error: 'Wallet not found' }); return }
    const agents = await getAgentsByOwner(user.id)
    if (!agents.length) { res.status(404).json({ error: 'No agent found for this wallet' }); return }
    const agent = agents[0]
    const all = readSettings()
    const settings = all[agent.id] ?? {
      agent_id: agent.id, auto_sport_bet: false, auto_sport_max_stake: 10, auto_sport_strategy: 'value' as const,
    }
    res.json({ agent: { id: agent.id, name: agent.name }, settings })
  } catch (err) { next(err) }
})

// PATCH /api/sport/wallet/:wallet/settings — requires signature
sportRouter.patch('/wallet/:wallet/settings', rateLimit(10), async (req, res, next) => {
  try {
    const wallet = req.params.wallet.toLowerCase()
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) { res.status(400).json({ error: 'Invalid wallet' }); return }

    const body = walletSettingsSchema.parse(req.body)

    // Verify timestamp (5 min window)
    const age = Math.floor(Date.now() / 1000) - body.timestamp
    if (age < 0 || age > 300) { res.status(400).json({ error: 'Signature expired' }); return }
    if (!consumeSignature(body.signature)) { res.status(400).json({ error: 'Signature already used' }); return }

    // Verify signature
    const message = `Update sport settings\nWallet: ${wallet}\nTimestamp: ${body.timestamp}`
    const recovered = ethers.verifyMessage(message, body.signature)
    if (recovered.toLowerCase() !== wallet) { res.status(401).json({ error: 'Invalid signature' }); return }

    const user = await getUserByWallet(wallet)
    if (!user) { res.status(404).json({ error: 'Wallet not found' }); return }
    const agents = await getAgentsByOwner(user.id)
    if (!agents.length) { res.status(404).json({ error: 'No agent found for this wallet' }); return }
    const agent = agents[0]

    const all = readSettings()
    const current = all[agent.id] ?? {
      agent_id: agent.id, auto_sport_bet: false, auto_sport_max_stake: 10, auto_sport_strategy: 'value' as const,
    }
    const updated: AgentSportSettings = {
      ...current,
      ...(body.auto_sport_bet !== undefined && { auto_sport_bet: body.auto_sport_bet }),
      ...(body.auto_sport_max_stake !== undefined && { auto_sport_max_stake: body.auto_sport_max_stake }),
      ...(body.auto_sport_strategy !== undefined && { auto_sport_strategy: body.auto_sport_strategy }),
    }
    all[agent.id] = updated
    writeSettings(all)
    res.json({ agent: { id: agent.id, name: agent.name }, settings: updated })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: err.flatten().fieldErrors }); return }
    next(err)
  }
})

// POST /api/sport/wallet/:wallet/bets — requires signature
sportRouter.post('/wallet/:wallet/bets', rateLimit(20), async (req, res, next) => {
  try {
    const wallet = req.params.wallet.toLowerCase()
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) { res.status(400).json({ error: 'Invalid wallet' }); return }

    const body = walletBetSchema.parse(req.body)

    // Verify timestamp (5 min window)
    const age = Math.floor(Date.now() / 1000) - body.timestamp
    if (age < 0 || age > 300) { res.status(400).json({ error: 'Signature expired' }); return }
    if (!consumeSignature(body.signature)) { res.status(400).json({ error: 'Signature already used' }); return }

    // Verify signature
    const message = `Place bet: ${body.event_id} ${body.selection} $${body.stake}\nWallet: ${wallet}\nTimestamp: ${body.timestamp}`
    const recovered = ethers.verifyMessage(message, body.signature)
    if (recovered.toLowerCase() !== wallet) { res.status(401).json({ error: 'Invalid signature' }); return }

    const user = await getUserByWallet(wallet)
    if (!user) { res.status(404).json({ error: 'Wallet not found' }); return }
    const agents = await getAgentsByOwner(user.id)
    if (!agents.length) { res.status(404).json({ error: 'No agent found for this wallet' }); return }
    const agent = agents[0]

    const event = MOCK_EVENTS.find((e) => e.id === body.event_id)
    if (!event) { res.status(404).json({ error: 'Event not found' }); return }
    const odds = event.odds[body.selection]
    if (!odds) { res.status(400).json({ error: 'Invalid selection' }); return }

    if (user.balance_usdc < body.stake) {
      res.status(400).json({ error: `Insufficient balance: $${user.balance_usdc.toFixed(2)} available` }); return
    }

    await updateBalance(user.id, -body.stake, 'buy_in')

    const bet: SportBet = {
      id: `sb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      agent_id: agent.id, agent_name: agent.name, user_id: user.id,
      event_id: body.event_id, event_name: `${event.home} vs ${event.away}`, sport: event.sport,
      selection: body.selection,
      selection_label: body.selection === 'home' ? event.home : body.selection === 'away' ? event.away : 'Draw',
      odds, stake: body.stake, potential_win: Number((body.stake * odds).toFixed(2)),
      status: 'pending', placed_at: new Date().toISOString(),
    }
    const bets = readBets(); bets.push(bet); writeBets(bets)
    res.status(201).json(bet)
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: err.flatten().fieldErrors }); return }
    next(err)
  }
})

// GET /api/sport/wallet/:wallet/bets — read-only, no auth needed
sportRouter.get('/wallet/:wallet/bets', async (req, res, next) => {
  try {
    const wallet = req.params.wallet.toLowerCase()
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) { res.status(400).json({ error: 'Invalid wallet' }); return }
    const user = await getUserByWallet(wallet)
    if (!user) { res.json([]); return }
    const agents = await getAgentsByOwner(user.id)
    if (!agents.length) { res.json([]); return }
    res.json(readBets().filter((b) => b.agent_id === agents[0].id))
  } catch (err) { next(err) }
})
