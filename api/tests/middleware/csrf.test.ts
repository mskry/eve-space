import { describe, expect, test } from 'vitest'
import { env } from '../../src/env.js'
import { app } from '../../src/index.js'

const missingRoute = '/csrf-middleware-test'
const fixtureSessionRoute = '/auth/local-fixture-session'

describe('global CSRF protection', () => {
  test.each([
    ['a missing content type', undefined],
    ['form data', 'multipart/form-data; boundary=csrf-test'],
    ['form URL encoding', 'application/x-www-form-urlencoded'],
    ['plain text', 'text/plain; charset=UTF-8'],
  ])('rejects cross-site POST requests with %s', async (_label, contentType) => {
    const response = await app.request(missingRoute, {
      headers: {
        Origin: 'https://attacker.invalid',
        'Sec-Fetch-Site': 'cross-site',
        ...(contentType && { 'Content-Type': contentType }),
      },
      method: 'POST',
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toStrictEqual({ message: 'Forbidden' })
  })

  test('rejects unsafe form-compatible requests without browser provenance', async () => {
    const response = await app.request(missingRoute, { method: 'POST' })

    expect(response.status).toBe(403)
  })

  test('allows unsafe form-compatible requests from the configured web origin', async () => {
    const response = await app.request(missingRoute, {
      headers: { Origin: 'http://localhost:3000' },
      method: 'POST',
    })

    expect(response.status).toBe(404)
  })

  test('allows unsafe form-compatible requests with same-origin fetch metadata', async () => {
    const response = await app.request(missingRoute, {
      headers: { 'Sec-Fetch-Site': 'same-origin' },
      method: 'POST',
    })

    expect(response.status).toBe(404)
  })

  test('accepts an opaque origin only for the development fixture session exchange', async () => {
    const nodeEnvironment = env.NODE_ENV
    const opaqueFormPost = {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'null',
        'Sec-Fetch-Site': 'cross-site',
      },
      method: 'POST',
    }
    try {
      env.NODE_ENV = 'production'
      expect((await app.request(fixtureSessionRoute, opaqueFormPost)).status).toBe(403)

      env.NODE_ENV = 'development'
      expect((await app.request(missingRoute, opaqueFormPost)).status).toBe(403)
      expect((await app.request(fixtureSessionRoute, opaqueFormPost)).status).toBe(400)
    } finally {
      env.NODE_ENV = nodeEnvironment
    }
  })

  test('leaves non-form JSON requests to the API route protections', async () => {
    const response = await app.request(missingRoute, {
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://attacker.invalid',
        'Sec-Fetch-Site': 'cross-site',
      },
      method: 'POST',
    })

    expect(response.status).toBe(404)
  })

  test.each(['GET', 'HEAD', 'OPTIONS'])('allows the safe %s method', async (method) => {
    const response = await app.request(missingRoute, { method })

    expect(response.status).toBe(404)
  })
})
