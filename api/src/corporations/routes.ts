import { Hono } from 'hono'
import { corporationAllianceHistoryRoutes } from './alliance-history-routes.js'
import { corporationCoreRoutes } from './core-routes.js'

export const corporationRoutes = new Hono()
  .route('/', corporationCoreRoutes)
  .route('/', corporationAllianceHistoryRoutes)
