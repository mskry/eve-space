import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../src/env.js', () => ({
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
  return new Response(JSON.stringify(metadata), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('EVE SSO discovery cache', () => {
  test('retries after a failed discovery instead of caching the rejection', async () => {
    fetchMock.mockRejectedValueOnce(new Error('The operation was aborted due to timeout'))
    const { createAuthorizationUrl } = await import('../../src/auth/sso.js')

    await expect(createAuthorizationUrl('state-one')).rejects.toMatchObject({
      name: 'SsoTransportError',
      cause: expect.objectContaining({ message: 'The operation was aborted due to timeout' }),
    })

    fetchMock.mockResolvedValueOnce(metadataResponse())
    await expect(createAuthorizationUrl('state-two')).resolves.toBeInstanceOf(URL)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('caches the successful discovery exactly once', async () => {
    fetchMock.mockResolvedValueOnce(metadataResponse())
    const { createAuthorizationUrl } = await import('../../src/auth/sso.js')

    await expect(createAuthorizationUrl('state-one')).resolves.toBeInstanceOf(URL)
    await expect(createAuthorizationUrl('state-two')).resolves.toBeInstanceOf(URL)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('does not cache a rejection raised by an error response', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }))
    const { createAuthorizationUrl } = await import('../../src/auth/sso.js')

    await expect(createAuthorizationUrl('state-one')).rejects.toThrow('HTTP 503')

    fetchMock.mockResolvedValueOnce(metadataResponse())
    await expect(createAuthorizationUrl('state-two')).resolves.toBeInstanceOf(URL)
  })

  test('identifies discovery transport and transient HTTP failures', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('Timed out', 'TimeoutError'))
    let sso = await import('../../src/auth/sso.js')
    let errors = await import('../../src/auth/sso-errors.js')

    const transportFailure = await sso.createAuthorizationUrl('state-one').catch((error) => error)
    expect(transportFailure).toBeInstanceOf(errors.SsoTransportError)
    expect(errors.isTransientSsoError(transportFailure)).toBe(true)

    vi.resetModules()
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 429 }))
    sso = await import('../../src/auth/sso.js')
    errors = await import('../../src/auth/sso-errors.js')
    const rateLimit = await sso.createAuthorizationUrl('state-two').catch((error) => error)
    expect(rateLimit).toMatchObject({ name: 'SsoHttpError', status: 429 })
    expect(errors.isTransientSsoError(rateLimit)).toBe(true)
  })

  test('distinguishes transient refresh failures from explicit rejection', async () => {
    fetchMock
      .mockResolvedValueOnce(metadataResponse())
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
    let sso = await import('../../src/auth/sso.js')
    let errors = await import('../../src/auth/sso-errors.js')

    const unavailable = await sso.refreshAccessToken('refresh').catch((error) => error)
    expect(unavailable).toMatchObject({ name: 'SsoHttpError', status: 503 })
    expect(errors.isTransientSsoError(unavailable)).toBe(true)

    vi.resetModules()
    fetchMock.mockResolvedValueOnce(metadataResponse()).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_grant' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    )
    sso = await import('../../src/auth/sso.js')
    errors = await import('../../src/auth/sso-errors.js')

    const rejected = await sso.refreshAccessToken('refresh').catch((error) => error)
    expect(rejected).toMatchObject({
      name: 'SsoTokenRejectedError',
      status: 401,
      upstreamStatus: 400,
    })
    expect(errors.isTransientSsoError(rejected)).toBe(false)
  })

  test('classifies a refresh rejection with an unparseable body by status', async () => {
    fetchMock.mockResolvedValueOnce(metadataResponse()).mockResolvedValueOnce(
      new Response('<html><body>401 Unauthorized</body></html>', {
        status: 401,
        headers: { 'content-type': 'text/html' },
      }),
    )
    const sso = await import('../../src/auth/sso.js')
    const errors = await import('../../src/auth/sso-errors.js')

    const failure = await sso.refreshAccessToken('refresh').catch((error) => error)
    expect(failure).toBeInstanceOf(errors.SsoHttpError)
    expect(failure).toMatchObject({ name: 'SsoHttpError', status: 401 })
    expect(errors.isTransientSsoError(failure)).toBe(false)
  })

  test('preserves transient JWKS HTTP status through jose verification', async () => {
    fetchMock
      .mockResolvedValueOnce(metadataResponse())
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
    const sso = await import('../../src/auth/sso.js')
    const errors = await import('../../src/auth/sso-errors.js')
    const token = [
      Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'key' })).toString('base64url'),
      Buffer.from(JSON.stringify({ aud: 'EVE Online' })).toString('base64url'),
      'signature',
    ].join('.')

    const failure = await sso.verifyAccessToken(token).catch((error) => error)
    expect(failure).toMatchObject({ name: 'SsoHttpError', status: 503 })
    expect(errors.isTransientSsoError(failure)).toBe(true)
  })
})
