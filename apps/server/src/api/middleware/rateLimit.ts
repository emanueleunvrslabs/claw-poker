import type { Request, Response, NextFunction } from 'express'

const counts = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(maxPerMinute = 60) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.agent?.id ?? req.ip ?? 'unknown'
    const now = Date.now()
    const entry = counts.get(key)

    if (!entry || now > entry.resetAt) {
      counts.set(key, { count: 1, resetAt: now + 60_000 })
      next()
      return
    }

    if (entry.count >= maxPerMinute) {
      res.status(429).json({ error: 'Rate limit exceeded' })
      return
    }

    entry.count++
    next()
  }
}
