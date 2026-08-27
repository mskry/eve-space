import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import type { SessionAccount } from '../auth-store.js'
import { findSession } from '../auth-store.js'
import { authRequiredBody } from '../http-contracts.js'

export const sessionCookie = 'eve_space_session'

export type SessionEnv = {
  Variables: {
    session: SessionAccount | null
  }
}

export const loadSession = createMiddleware<SessionEnv>(async (context, next) => {
  const sessionToken = getCookie(context, sessionCookie)
  context.set('session', sessionToken ? await findSession(sessionToken) : null)
  await next()
})

export const requireSession = createMiddleware<SessionEnv>(async (context, next) => {
  if (!context.var.session) {
    return context.json(authRequiredBody, 401)
  }
  await next()
})
