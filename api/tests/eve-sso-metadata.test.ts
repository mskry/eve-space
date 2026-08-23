import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../src/env.js', () => ({
  env: { EVE_SSO_TIMEOUT_MS: 15_000, ESI_USER_AGENT: 'EveSpace/Test' },
  getSsoConfig: () => ({
    callbackUrl: 'http://localhost:8788/auth/eve/callback',
    clientId: 'test-client',
    clientSecret: 'test-secret',
    scopes: [],
  }),
}))

const metadata = {
  issuer: 'https://login.eveonline.com',
  authorization_endpoint: 'https://login.eveonline.com/v2/oauth/authorize',
  token_endpoint: 'https://login.eveonline.com/v2/oauth/token',
  jwks_uri: 'https://login.eveonline.com/oauth/jwks',
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.resetModules()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function metadataResponse() {
  return { ok: true, json: async () => metadata }
}

describe('EVE SSO discovery cache', () => {
  test('retries after a failed discovery instead of caching the rejection', async () => {
    fetchMock.mockRejectedValueOnce(new Error('The operation was aborted due to timeout'))
    const { createAuthorizationUrl } = await import('../src/eve-sso.js')

    await expect(createAuthorizationUrl('state-one')).rejects.toThrow('aborted due to timeout')

    fetchMock.mockResolvedValueOnce(metadataResponse())
    await expect(createAuthorizationUrl('state-two')).resolves.toBeInstanceOf(URL)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('caches the successful discovery exactly once', async () => {
    fetchMock.mockResolvedValueOnce(metadataResponse())
    const { createAuthorizationUrl } = await import('../src/eve-sso.js')

    await expect(createAuthorizationUrl('state-one')).resolves.toBeInstanceOf(URL)
    await expect(createAuthorizationUrl('state-two')).resolves.toBeInstanceOf(URL)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('does not cache a rejection raised by an error response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 })
    const { createAuthorizationUrl } = await import('../src/eve-sso.js')

    await expect(createAuthorizationUrl('state-one')).rejects.toThrow('HTTP 503')

    fetchMock.mockResolvedValueOnce(metadataResponse())
    await expect(createAuthorizationUrl('state-two')).resolves.toBeInstanceOf(URL)
  })
})
