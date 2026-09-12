import { Hono } from 'hono'
import type { ApplyGlobalResponse } from 'hono/client'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import { honoLogLayer, type HonoLogLayerVariables } from '@loglayer/hono'
import type { PlatformModuleErrorBody } from '@eve-space/platform-module-contract'
import { PlatformModuleHttpError } from '@eve-space/platform-module-server'
import { env } from './env.js'
import { CharacterTokenNotFoundError } from './auth/character-token-store.js'
import { installedModuleRoutes } from './generated/platform/installed-module-routes.js'
import { routeNotFoundBody } from './http/contracts.js'
import { mailRoutes } from './mail/routes.js'
import { adminRoutes } from './admin/routes.js'
import { characterRoutes } from './characters/routes.js'
import { corporationRoutes } from './corporations/routes.js'
import { healthRoutes } from './system/health-routes.js'
import { moduleRuntimeRoutes } from './platform/routes.js'
import { publicCharacterRoutes } from './characters/public-routes.js'
import { statusRoutes } from './system/status-routes.js'
import { ssoRoutes } from './auth/routes.js'
import { loadSession, requireSession } from './middleware/auth-session.js'
import { TokenRefreshUnavailableError } from './auth/token-errors.js'
import { organizationRoutes } from './organization/routes.js'
import { universeRoutes } from './universe/routes.js'
import { apiLogger, safeErrorMetadata, safeRequestMetadata } from './logging.js'

type GlobalErrorBody = { message: string } | PlatformModuleErrorBody

export const app = new Hono<{ Variables: HonoLogLayerVariables }>()
  .use(
    '*',
    honoLogLayer({
      instance: apiLogger,
      autoLogging: false,
    }),
  )
  .use('*', async (context, next) => {
    const startedAt = Date.now()
    await next()
    if (context.req.path === '/health') return
    context.var.logger
      .withMetadata({
        req: safeRequestMetadata(context.req.raw, context.req.path),
        res: { statusCode: context.res.status },
        responseTime: Date.now() - startedAt,
      })
      .info('request completed')
  })
  .use('*', secureHeaders())
  .use('/api/*', cors({ origin: env.WEB_ORIGIN, credentials: true }))
  .use('/auth/*', cors({ origin: env.WEB_ORIGIN, credentials: true }))
  .route('/health', healthRoutes)
  .route('/api/status', statusRoutes)
  .route('/api/modules', moduleRuntimeRoutes)
  .route('/api/modules', installedModuleRoutes)
  .route('/api/universe', universeRoutes)
  .use('/api/characters/*', loadSession, requireSession)
  .use('/api/corporations/*', loadSession, requireSession)
  .route('/api/admin', adminRoutes)
  .route('/api/me/characters', characterRoutes)
  .route('/api/me/characters', mailRoutes)
  .route('/api/characters', publicCharacterRoutes)
  .route('/api/corporations', corporationRoutes)
  .route('/api/organization', organizationRoutes)
  .route('/auth', ssoRoutes)

app.notFound((context) => context.json(routeNotFoundBody, 404))

app.onError((error, context) => {
  if (error instanceof CharacterTokenNotFoundError) {
    return context.json({ message: 'EVE authorization is temporarily unavailable.' }, 503)
  }
  if (error instanceof TokenRefreshUnavailableError) {
    return context.json({ message: 'EVE token refresh is temporarily unavailable.' }, 503)
  }
  if (error instanceof PlatformModuleHttpError) {
    return context.json(error.body, error.status)
  }
  if (error instanceof HTTPException) {
    return context.json({ message: error.message }, error.status)
  }

  const request = safeRequestMetadata(context.req.raw, context.req.path)
  context.var.logger
    .withMetadata(unexpectedErrorDetails(error, request.method, request.url))
    .error('Unhandled API error')
  return context.json({ message: 'Internal server error' }, 500)
})

export type AppType = ApplyGlobalResponse<
  typeof app,
  {
    400: { json: GlobalErrorBody }
    403: { json: GlobalErrorBody }
    404: { json: GlobalErrorBody }
    409: { json: GlobalErrorBody }
    422: { json: GlobalErrorBody }
    429: { json: GlobalErrorBody }
    500: { json: { message: string } }
    502: { json: GlobalErrorBody }
    503: { json: GlobalErrorBody }
  }
>

function unexpectedErrorDetails(error: unknown, method: string, path: string) {
  const request = { category: 'unexpected application failure', method, path }
  return { ...request, ...safeErrorMetadata(error) }
}
