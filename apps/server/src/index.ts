import express from 'express'
import { createServer } from 'http'
import cors from 'cors'
import helmet from 'helmet'
import { config } from './config'
import { apiRouter } from './api/router'
import { errorHandler } from './api/middleware/errorHandler'
import { setupWebSocket } from './ws/server'

const app = express()

app.use(helmet())
app.use(cors({ origin: '*' }))
app.use(express.json())

app.use(apiRouter)

// Serve skill.md as static file
app.get('/skill.md', (_req, res) => {
  res.setHeader('Content-Type', 'text/markdown')
  res.sendFile('skill.md', { root: process.cwd() + '/../../' })
})

app.use(errorHandler)

const httpServer = createServer(app)
const io = setupWebSocket(httpServer)

httpServer.listen(config.PORT, () => {
  console.log(`[server] Claw Poker running on port ${config.PORT}`)
  console.log(`[server] Environment: ${config.NODE_ENV}`)
})

export { app, io }
