import type { MiddlewareHandler } from 'hono'
import { readAuthCookie } from '../http/auth-cookie.js'
import { setPrivateHeaders } from '../http/private-response.js'
import { findAdminSession, type AdminSessionAccount } from './store.js'

export type AdminEnv = { Variables: { adminSession: AdminSessionAccount | null } }
export const adminSessionCookie = 'eve_space_admin_session'

export const loadAdminSession: MiddlewareHandler<AdminEnv> = async (context, next) => {
  setPrivateHeaders(context)
  const token = readAuthCookie(context, adminSessionCookie)
  context.set('adminSession', token ? await findAdminSession(token) : null)
  return next()
}

export const requireAdminSession: MiddlewareHandler<AdminEnv> = async (context, next) => {
  if (!context.var.adminSession) {
    return context.json(
      { code: 'ADMIN_AUTH_REQUIRED', message: 'Administrator login is required.' },
      401,
    )
  }
  return next()
}
