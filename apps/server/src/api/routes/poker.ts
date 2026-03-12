import { Router } from 'express'
import * as fs from 'fs'
import * as path from 'path'

export const pokerRouter = Router()

// ── Persistent storage ─────────────────────────────────────────────────────
const DATA_DIR = path.join(process.cwd(), 'data')
const POKER_SETTINGS_FILE = path.join(DATA_DIR, 'poker_settings.json')

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

export interface AgentPokerSettings {
  agent_id: string
  auto_poker: boolean
  auto_poker_max_buyin: number
}

export function readPokerSettings(): Record<string, AgentPokerSettings> {
  try {
    ensureDataDir()
    if (!fs.existsSync(POKER_SETTINGS_FILE)) return {}
    return JSON.parse(fs.readFileSync(POKER_SETTINGS_FILE, 'utf8'))
  } catch { return {} }
}

export function writePokerSettings(settings: Record<string, AgentPokerSettings>) {
  ensureDataDir()
  fs.writeFileSync(POKER_SETTINGS_FILE, JSON.stringify(settings, null, 2))
}

// ── GET /api/poker/wallet/:wallet/settings ─────────────────────────────────
pokerRouter.get('/wallet/:wallet/settings', async (req, res, next) => {
  try {
    const { getUserByWallet } = await import('../../db/queries/users')
    const { getAgentsByOwner } = await import('../../db/queries/agents')
    const user = await getUserByWallet(req.params.wallet)
    if (!user) { res.status(404).json({ error: 'Wallet not found' }); return }
    const agents = await getAgentsByOwner(user.id)
    if (!agents.length) { res.status(404).json({ error: 'No agent found for this wallet' }); return }
    const agent = agents[0]
    const all = readPokerSettings()
    const settings = all[agent.id] ?? {
      agent_id: agent.id,
      auto_poker: false,
      auto_poker_max_buyin: 10,
    }
    res.json({ agent: { id: agent.id, name: agent.name }, settings })
  } catch (err) { next(err) }
})

// ── PATCH /api/poker/wallet/:wallet/settings ───────────────────────────────
pokerRouter.patch('/wallet/:wallet/settings', async (req, res, next) => {
  try {
    const { getUserByWallet } = await import('../../db/queries/users')
    const { getAgentsByOwner } = await import('../../db/queries/agents')
    const user = await getUserByWallet(req.params.wallet)
    if (!user) { res.status(404).json({ error: 'Wallet not found' }); return }
    const agents = await getAgentsByOwner(user.id)
    if (!agents.length) { res.status(404).json({ error: 'No agent found for this wallet' }); return }
    const agent = agents[0]
    const { auto_poker, auto_poker_max_buyin } = req.body
    const all = readPokerSettings()
    const current = all[agent.id] ?? {
      agent_id: agent.id,
      auto_poker: false,
      auto_poker_max_buyin: 10,
    }
    const updated: AgentPokerSettings = {
      ...current,
      ...(typeof auto_poker === 'boolean' && { auto_poker }),
      ...(typeof auto_poker_max_buyin === 'number' && auto_poker_max_buyin > 0 && { auto_poker_max_buyin }),
    }
    all[agent.id] = updated
    writePokerSettings(all)
    res.json({ agent: { id: agent.id, name: agent.name }, settings: updated })
  } catch (err) { next(err) }
})

// ── GET /api/poker/settings/all — for auto-join engine ────────────────────
pokerRouter.get('/settings/all', (_req, res) => {
  res.json(readPokerSettings())
})
