import type { Request, Response, NextFunction } from 'express'
import { verifyApiKey } from '../../db/queries/agents'
import type { AgentRow } from '../../db/queries/agents'

declare global {
  namespace Express {
    interface Request {
      agent?: AgentRow
    }
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization header' })
    return
  }

  const apiKey = authHeader.slice(7)
  const agent = await verifyApiKey(apiKey)

  if (!agent) {
    res.status(401).json({ error: 'Invalid API key' })
    return
  }

  if (!agent.is_active) {
    res.status(403).json({ error: 'Agent is deactivated' })
    return
  }

  req.agent = agent
  next()
}
