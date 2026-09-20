import { Hono } from 'hono'
import { characterRoutes } from './characters/routes.js'
import { mailRoutes } from './mail/routes.js'
import { statusRoutes } from './system/status-routes.js'
import { loadSession, requireSession } from './middleware/auth-session.js'

export const app = new Hono()
  .use('*', async (context, next) => {
    await next()
  })
  .use('/api/characters/*', loadSession, requireSession)
  .route('/api/status', statusRoutes)
  .route('/api/me/characters', characterRoutes)
  .route('/api/me/characters', mailRoutes)
