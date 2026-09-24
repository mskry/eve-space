import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { env } from '../env.js'

export function setAuthCookie(
  context: Context,
  name: string,
  value: string,
  maxAge: number,
  path = '/',
) {
  setCookie(context, name, value, {
    httpOnly: true,
    maxAge,
    path,
    prefix: authCookiePrefix(path),
    priority: 'High',
    sameSite: 'Lax',
    secure: usesSecureAuthCookies(),
  })
}

export function readAuthCookie(context: Context, name: string, path = '/') {
  return getCookie(context, name, authCookiePrefix(path))
}

export function deleteAuthCookie(context: Context, name: string, path = '/') {
  deleteCookie(context, name, {
    path,
    prefix: authCookiePrefix(path),
    secure: usesSecureAuthCookies(),
  })
}

function authCookiePrefix(path: string) {
  if (!usesSecureAuthCookies()) {
    return
  }
  return path === '/' ? 'host' : 'secure'
}

function usesSecureAuthCookies() {
  return new URL(env.EVE_CALLBACK_URL).protocol === 'https:'
}
