import { Hono } from 'hono'
import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { PlatformModuleHttpError, platformModuleError, zValidator } from '../src/index.js'

describe('platform module server surface', () => {
  test('uses the canonical validation error without invoking the handler', async () => {
    let invoked = false
    const app = new Hono().post(
      '/',
      zValidator('json', z.object({ name: z.string().min(1, 'Name is required.') })),
      (context) => {
        invoked = true
        return context.json({ name: context.req.valid('json').name })
      },
    )

    const response = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })

    expect(response.status).toBe(400)
    await expect(response.text()).resolves.toBe('Name is required.')
    expect(invoked).toBe(false)
  })

  test('retains typed validated input for valid requests', async () => {
    const app = new Hono().post(
      '/',
      zValidator('json', z.object({ count: z.number().int().positive() })),
      (context) => context.json({ count: context.req.valid('json').count }),
    )

    const response = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ count: 2 }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ count: 2 })
  })

  test('constructs only bounded expected HTTP errors', () => {
    const error = platformModuleError(409, {
      code: 'ACTIVITY_ALREADY_EXISTS',
      message: 'The activity already exists.',
      secret: 'must-not-leak',
    } as Parameters<typeof platformModuleError>[1] & { secret: string })

    expect(error).toBeInstanceOf(PlatformModuleHttpError)
    expect(error.status).toBe(409)
    expect(error.body).toEqual({
      code: 'ACTIVITY_ALREADY_EXISTS',
      message: 'The activity already exists.',
    })
    expect(() =>
      platformModuleError(400, { code: 'invalid-code', message: 'Invalid request.' }),
    ).toThrow('bounded uppercase snake case')
  })
})
