import { Hono } from 'hono'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { deleteAuthCookie, readAuthCookie, setAuthCookie } from '../../src/http/auth-cookie.js'

const environment = vi.hoisted(() => ({ EVE_CALLBACK_URL: '' }))
const callbackPath = '/auth/eve/callback'

vi.mock('../../src/env.js', () => ({ env: environment }))

const app = new Hono()
  .get('/set', (context) => {
    setAuthCookie(context, 'session', 'token', 60)
    setAuthCookie(context, 'state', 'nonce', 600, callbackPath)
    return context.body(null, 204)
  })
  .get('/read', (context) =>
    context.json({
      session: readAuthCookie(context, 'session') ?? null,
      state: readAuthCookie(context, 'state', callbackPath) ?? null,
    }),
  )
  .get('/delete', (context) => {
    deleteAuthCookie(context, 'session')
    deleteAuthCookie(context, 'state', callbackPath)
    return context.body(null, 204)
  })

beforeEach(() => {
  environment.EVE_CALLBACK_URL = 'http://localhost:8788/auth/eve/callback'
})

describe('authentication cookies', () => {
  test('keeps local HTTP development cookies unprefixed and non-secure', async () => {
    const [session, state] = (await app.request('/set')).headers.getSetCookie()
    const read = await app.request('/read', { headers: { Cookie: 'session=token; state=nonce' } })

    expect(session).toMatch(/^session=token;/)
    expect(session).toContain('HttpOnly')
    expect(session).toContain('SameSite=Lax')
    expect(session).toContain('Priority=High')
    expect(session).not.toContain('Secure')
    expect(state).toMatch(/^state=nonce;/)
    expect(state).toContain(`Path=${callbackPath}`)
    expect(await read.json()).toStrictEqual({ session: 'token', state: 'nonce' })
  })

  test('uses host and secure prefixes when the public API URL uses HTTPS', async () => {
    environment.EVE_CALLBACK_URL = 'https://api.example.com/auth/eve/callback'

    const [session, state] = (await app.request('/set')).headers.getSetCookie()

    expect(session).toMatch(/^__Host-session=token;/)
    expect(session).toContain('Path=/;')
    expect(session).toContain('Secure')
    expect(state).toMatch(/^__Secure-state=nonce;/)
    expect(state).toContain(`Path=${callbackPath}`)
    expect(state).toContain('Secure')
  })

  test('ignores unprefixed look-alike cookies when HTTPS cookies are prefixed', async () => {
    environment.EVE_CALLBACK_URL = 'https://api.example.com/auth/eve/callback'

    const prefixed = await app.request('/read', {
      headers: { Cookie: '__Host-session=token; __Secure-state=nonce; session=forged' },
    })
    const unprefixed = await app.request('/read', {
      headers: { Cookie: 'session=forged; state=forged' },
    })

    expect(await prefixed.json()).toStrictEqual({ session: 'token', state: 'nonce' })
    expect(await unprefixed.json()).toStrictEqual({ session: null, state: null })
  })

  test('expires the prefixed cookie names over HTTPS', async () => {
    environment.EVE_CALLBACK_URL = 'https://api.example.com/auth/eve/callback'

    const [session, state] = (await app.request('/delete')).headers.getSetCookie()

    expect(session).toMatch(/^__Host-session=;/)
    expect(session).toContain('Max-Age=0')
    expect(state).toMatch(/^__Secure-state=;/)
    expect(state).toContain(`Path=${callbackPath}`)
  })
})
