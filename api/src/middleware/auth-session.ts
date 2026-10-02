import { createMiddleware } from 'hono/factory'
import type { Context } from 'hono'
import { findSession, type SessionAccount } from '../auth/session-store.js'
import { readAuthCookie } from '../http/auth-cookie.js'
import { sessionAdmissionDenial } from '../auth/read-admission.js'

export const sessionCookie = 'eve_space_session'

export type SessionEnv = {
  Variables: {
    session: SessionAccount | null
  }
}

export const readRequestSession = (context: Context) => {
  const sessionToken = readAuthCookie(context, sessionCookie)
  return sessionToken ? findSession(sessionToken) : Promise.resolve(null)
}

export const loadSession = createMiddleware<SessionEnv>(async (context, next) => {
  context.set('session', await readRequestSession(context))
  await next()
})

export const requireSession = createMiddleware<SessionEnv>(async (context, next) => {
  const denial = sessionAdmissionDenial(context.var.session)
  if (denial) return context.json(denial.body, denial.status)
  await next()
})
