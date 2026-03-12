import type { Request, Response, NextFunction } from 'express'

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  console.error('[ERROR]', err)
  const isProd = process.env.NODE_ENV === 'production'
  res.status(500).json({ error: isProd ? 'Internal server error' : (err.message ?? 'Internal server error') })
}
