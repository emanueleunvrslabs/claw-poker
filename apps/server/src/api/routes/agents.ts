import { Router } from 'express'
import { z } from 'zod'
import { createAgent, getAgentById, getLeaderboard } from '../../db/queries/agents'
import { upsertUser, getUserByWallet } from '../../db/queries/users'
import { authMiddleware } from '../middleware/auth'
import { rateLimit } from '../middleware/rateLimit'

export const agentsRouter = Router()

const registerSchema = z.object({
  agent_name: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_-]+$/),
  owner_wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  agent_type: z.string().default('openclaw'),
})

// POST /api/agents/register
agentsRouter.post('/register', rateLimit(10), async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body)

    // Upsert user by wallet
    const user = await upsertUser(body.owner_wallet)

    // Create agent
    const { agent, api_key } = await createAgent({
      name: body.agent_name,
      owner_id: user.id,
      agent_type: body.agent_type,
    })

    res.status(201).json({
      agent_id: agent.id,
      api_key,
      message: 'Welcome to Claw Poker!',
    })
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.flatten().fieldErrors })
      return
    }
    // Duplicate name
    if (err instanceof Error && err.message.includes('unique')) {
      res.status(409).json({ error: 'Agent name already taken' })
      return
    }
    next(err)
  }
})

// GET /api/agents/me
agentsRouter.get('/me', authMiddleware, async (req, res, next) => {
  try {
    res.json(req.agent)
  } catch (err) {
    next(err)
  }
})

// GET /api/agents/:id
agentsRouter.get('/:id', async (req, res, next) => {
  try {
    const agent = await getAgentById(req.params.id)
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' })
      return
    }
    // Don't expose api_key_hash
    const { api_key_hash: _, ...safeAgent } = agent
    res.json(safeAgent)
  } catch (err) {
    next(err)
  }
})

// GET /api/agents/leaderboard
agentsRouter.get('/leaderboard/top', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 100)
    const agents = await getLeaderboard(limit)
    const safe = agents.map(({ api_key_hash: _, ...a }) => a)
    res.json(safe)
  } catch (err) {
    next(err)
  }
})
