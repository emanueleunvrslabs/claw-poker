import { Router } from 'express'
import { healthRouter } from './routes/health'
import { agentsRouter } from './routes/agents'
import { tournamentsRouter } from './routes/tournaments'
import { usersRouter } from './routes/users'

export const apiRouter = Router()

apiRouter.use('/', healthRouter)
apiRouter.use('/api/agents', agentsRouter)
apiRouter.use('/api/tournaments', tournamentsRouter)
apiRouter.use('/api/users', usersRouter)
