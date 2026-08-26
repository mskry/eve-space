import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { loadSession, requireSession, type SessionEnv } from '../middleware/auth-session.js'
import { loadModuleRuntimeState } from '../platform/module-settings.js'

const privateResponse = createMiddleware<SessionEnv>(async (context, next) => {
  context.header('Cache-Control', 'private, no-store')
  context.header('Vary', 'Cookie')
  await next()
})

export const moduleRuntimeRoutes = new Hono<SessionEnv>().get(
  '/',
  privateResponse,
  loadSession,
  requireSession,
  async (context) => {
    return context.json(await loadModuleRuntimeState(), 200)
  },
)
