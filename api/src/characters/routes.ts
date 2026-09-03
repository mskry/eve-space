import { Hono } from 'hono'
import type { OwnedCharacterEnv } from '../middleware/owned-character.js'
import { characterClonesRoutes } from './clones-routes.js'
import { characterCoreRoutes } from './core-routes.js'
import { characterFinanceRoutes } from './finance-routes.js'
import { characterHistoryRoutes } from './history-routes.js'
import { characterProgressionRoutes } from './progression-routes.js'

export const characterRoutes = new Hono<OwnedCharacterEnv>()
  .route('/', characterCoreRoutes)
  .route('/', characterProgressionRoutes)
  .route('/', characterClonesRoutes)
  .route('/', characterFinanceRoutes)
  .route('/', characterHistoryRoutes)
