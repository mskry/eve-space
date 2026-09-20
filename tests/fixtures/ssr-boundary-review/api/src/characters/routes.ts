import { Hono } from 'hono'
import { characterCoreRoutes } from './core-routes.js'

export const characterRoutes = new Hono()
  .use('*', loadSession, requireSession, loadOrganizationSession)
  .route('/', characterCoreRoutes)
