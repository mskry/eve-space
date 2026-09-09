import { describe, expect, test, vi } from 'vitest'
import { app } from '../../src/index.js'
import { apiLogger } from '../../src/logging.js'

describe('API request logging', () => {
  test('writes one structured completion event without query parameters', async () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    apiLogger.enableLogging()

    try {
      const response = await app.request('/api/modules/not-installed?token=private', {
        headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' },
      })

      expect(response.status).toBe(404)
      expect(consoleInfo).toHaveBeenCalledOnce()

      const serializedEvent = String(consoleInfo.mock.calls[0]?.[0])
      const event = JSON.parse(serializedEvent)
      expect(event).toEqual(
        expect.objectContaining({
          level: 'info',
          msg: 'request completed',
          requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
          req: {
            method: 'GET',
            url: '/api/modules/not-installed',
            remoteAddress: '203.0.113.10',
          },
          res: { statusCode: 404 },
          responseTime: expect.any(Number),
          time: expect.any(String),
        }),
      )
      expect(serializedEvent).not.toContain('token=private')
    } finally {
      apiLogger.disableLogging()
      consoleInfo.mockRestore()
    }
  })

  test.each(['/access_token=private-value', '/access_token%253Dprivate-value'])(
    'redacts credential-bearing request path %s and rejects an invalid client address',
    async (path) => {
      const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
      apiLogger.enableLogging()

      try {
        const response = await app.request(path, {
          headers: { 'x-forwarded-for': 'authorization=Bearer private-value' },
        })

        expect(response.status).toBe(404)
        expect(consoleInfo).toHaveBeenCalledOnce()

        const serializedEvent = String(consoleInfo.mock.calls[0]?.[0])
        const event = JSON.parse(serializedEvent)
        expect(event.req).toEqual({ method: 'GET', url: '[redacted]' })
        expect(serializedEvent).not.toContain('private-value')
        expect(serializedEvent).not.toContain('authorization=Bearer')
      } finally {
        apiLogger.disableLogging()
        consoleInfo.mockRestore()
      }
    },
  )
})
