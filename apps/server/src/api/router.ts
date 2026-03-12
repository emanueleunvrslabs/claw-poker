import { Router } from 'express'
import { healthRouter } from './routes/health'
import { agentsRouter } from './routes/agents'
import { tournamentsRouter } from './routes/tournaments'
import { usersRouter } from './routes/users'
import { sportRouter } from './routes/sport'
import { pokerRouter } from './routes/poker'

export const apiRouter = Router()

apiRouter.use('/', healthRouter)
apiRouter.use('/api/agents', agentsRouter)
apiRouter.use('/api/tournaments', tournamentsRouter)
apiRouter.use('/api/users', usersRouter)
apiRouter.use('/api/sport', sportRouter)
apiRouter.use('/api/poker', pokerRouter)
