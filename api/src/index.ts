import { Hono } from 'hono'
import type { ApplyGlobalResponse } from 'hono/client'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import { env } from './env.js'
import { adminRoutes } from './routes/admin.js'
import { characterRoutes } from './routes/characters.js'
import { healthRoutes } from './routes/health.js'
import { statusRoutes } from './routes/status.js'
import { ssoRoutes } from './sso-routes.js'

export const app = new Hono()
  .use('*', secureHeaders())
  .use('/api/*', cors({ origin: env.WEB_ORIGIN, credentials: true }))
  .use('/auth/*', cors({ origin: env.WEB_ORIGIN, credentials: true }))
  .route('/health', healthRoutes)
  .route('/api/status', statusRoutes)
  .route('/api/admin', adminRoutes)
  .route('/api/me/characters', characterRoutes)
  .route('/auth', ssoRoutes)

app.notFound((context) => context.json({ message: 'Route not found' }, 404))

app.onError((error, context) => {
  if (error instanceof HTTPException) {
    return context.json({ message: error.message }, error.status)
  }

  console.error('Unhandled API error', error)
  return context.json({ message: 'Internal server error' }, 500)
})

export type AppType = ApplyGlobalResponse<
  typeof app,
  {
    400: { json: { message: string } }
    404: { json: { message: string } }
    500: { json: { message: string } }
    502: { json: { message: string } }
    503: { json: { message: string } }
  }
>
