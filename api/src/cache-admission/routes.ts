import { Hono } from 'hono'
import { privateNoStore } from '../http/private-response.js'
import { loadSession, requireSession, type SessionEnv } from '../middleware/auth-session.js'
import { loadCacheAdmissionContext } from './service.js'

export const cacheAdmissionRoutes = new Hono<SessionEnv>().get(
  '/',
  privateNoStore,
  loadSession,
  requireSession,
  async (context) =>
    context.json(await loadCacheAdmissionContext(context.var.session!.userId), 200),
)
