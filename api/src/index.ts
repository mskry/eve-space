import { Hono } from 'hono'
import type { ApplyGlobalResponse } from 'hono/client'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import { env } from './env.js'
import { CharacterTokenNotFoundError } from './auth-store.js'
import { installedModuleRoutes } from './generated/platform/installed-module-routes.js'
import { routeNotFoundBody } from './http-contracts.js'
import { mailRoutes } from './mail/routes.js'
import { adminRoutes } from './routes/admin.js'
import { characterRoutes } from './routes/characters.js'
import { corporationRoutes } from './routes/corporations.js'
import { healthRoutes } from './routes/health.js'
import { moduleRuntimeRoutes } from './routes/modules.js'
import { publicCharacterRoutes } from './routes/public-characters.js'
import { statusRoutes } from './routes/status.js'
import { ssoRoutes } from './sso-routes.js'
import { loadSession, requireSession } from './middleware/auth-session.js'
import { TokenRefreshUnavailableError } from './token-service.js'

export const app = new Hono()
  .use('*', secureHeaders())
  .use('/api/*', cors({ origin: env.WEB_ORIGIN, credentials: true }))
  .use('/auth/*', cors({ origin: env.WEB_ORIGIN, credentials: true }))
  .route('/health', healthRoutes)
  .route('/api/status', statusRoutes)
  .route('/api/modules', moduleRuntimeRoutes)
  .route('/api/modules', installedModuleRoutes)
  .use('/api/admin/*', loadSession, requireSession)
  .use('/api/characters/*', loadSession, requireSession)
  .use('/api/corporations/*', loadSession, requireSession)
  .route('/api/admin', adminRoutes)
  .route('/api/me/characters', characterRoutes)
  .route('/api/me/characters', mailRoutes)
  .route('/api/characters', publicCharacterRoutes)
  .route('/api/corporations', corporationRoutes)
  .route('/auth', ssoRoutes)

app.notFound((context) => context.json(routeNotFoundBody, 404))

app.onError((error, context) => {
  if (error instanceof CharacterTokenNotFoundError) {
    return context.json({ message: 'EVE authorization is temporarily unavailable.' }, 503)
  }
  if (error instanceof TokenRefreshUnavailableError) {
    return context.json({ message: 'EVE token refresh is temporarily unavailable.' }, 503)
  }
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
