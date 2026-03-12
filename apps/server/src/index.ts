import express from 'express'
import { createServer } from 'http'
import cors from 'cors'
import helmet from 'helmet'
import path from 'path'
import { config } from './config'
import { apiRouter } from './api/router'
import { errorHandler } from './api/middleware/errorHandler'
import { setupWebSocket } from './ws/server'
import { startSportAutoBet } from './demo/sportAutoBet'
import { startPokerAutoJoin } from './demo/pokerAutoJoin'

const app = express()

const ALLOWED_ORIGINS = config.NODE_ENV === 'production'
  ? [
      'https://squidcasino.unvrslabs.dev',
      'https://www.squidcasino.unvrslabs.dev',
      process.env.FRONTEND_URL,
    ].filter(Boolean) as string[]
  : true // allow all in dev

app.use(helmet())
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }))
app.use(express.json())

app.use(apiRouter)

// Serve skill.md — pinned to exact file, not a broad directory
const SKILL_MD_PATH = path.resolve(__dirname, '../../..', 'skill.md')
app.get('/skill.md', (_req, res) => {
  res.setHeader('Content-Type', 'text/markdown')
  res.sendFile(SKILL_MD_PATH)
})

app.use(errorHandler)

const httpServer = createServer(app)
const io = setupWebSocket(httpServer)

httpServer.listen(config.PORT, () => {
  console.log(`[server] Claw Poker running on port ${config.PORT}`)
  startSportAutoBet()
  startPokerAutoJoin()
  console.log(`[server] Environment: ${config.NODE_ENV}`)
})

export { app, io }
