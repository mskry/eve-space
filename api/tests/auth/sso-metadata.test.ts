import { exportJWK, generateKeyPair, SignJWT } from 'jose'
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

describe('EVE SSO requests', () => {
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
    expect(errors.isTransientSsoError(new errors.SsoHttpError('test', 600))).toBe(false)
  })

  test('exchanges authorization codes and preserves HTTP failures', async () => {
    const token = {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 1_200,
      token_type: 'Bearer',
    }
    fetchMock
      .mockResolvedValueOnce(metadataResponse())
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(token), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    const sso = await import('../../src/auth/sso.js')

    await expect(sso.exchangeAuthorizationCode('first-code')).rejects.toMatchObject({
      name: 'SsoHttpError',
      operation: 'EVE token exchange',
      status: 502,
    })
    await expect(sso.exchangeAuthorizationCode('second-code')).resolves.toEqual(token)
  })

  test('wraps response body failures as SSO transport errors', async () => {
    const cause = new Error('response stream failed')
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: vi.fn().mockRejectedValue(cause),
    } as unknown as Response)
    const sso = await import('../../src/auth/sso.js')
    const errors = await import('../../src/auth/sso-errors.js')

    const failure = await sso.createAuthorizationUrl('state').catch((error) => error)
    expect(failure).toBeInstanceOf(errors.SsoTransportError)
    expect(failure).toMatchObject({ cause })
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

  test('accepts refresh responses and distinguishes OAuth rejection codes', async () => {
    const refreshed = {
      access_token: 'new-access-token',
      expires_in: 1_200,
      token_type: 'Bearer',
    }
    fetchMock
      .mockResolvedValueOnce(metadataResponse())
      .mockResolvedValueOnce(
        new Response(JSON.stringify(refreshed), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'invalid_token' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'temporarily_unavailable' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      )
    const sso = await import('../../src/auth/sso.js')
    const errors = await import('../../src/auth/sso-errors.js')

    await expect(sso.refreshAccessToken('refresh')).resolves.toEqual(refreshed)
    await expect(sso.refreshAccessToken('rejected')).rejects.toMatchObject({
      name: 'SsoTokenRejectedError',
      status: 401,
      upstreamStatus: 403,
    })
    const unavailable = await sso
      .refreshAccessToken('temporarily-unavailable')
      .catch((error) => error)
    expect(unavailable).toBeInstanceOf(errors.SsoHttpError)
    expect(unavailable).toMatchObject({ status: 400 })
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

  test('verifies access tokens through the decoded JWKS response', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const publicJwk = await exportJWK(publicKey)
    const token = await new SignJWT({
      sub: 'CHARACTER:EVE:1404328063',
      name: 'Test Character',
      scp: 'scope.one scope.two',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(metadata.issuer)
      .setAudience(['EVE Online', 'test-client'])
      .setExpirationTime('5m')
      .sign(privateKey)
    const jwksBody = JSON.stringify({
      keys: [{ ...publicJwk, alg: 'RS256', kid: 'test-key', use: 'sig' }],
    })
    fetchMock.mockResolvedValueOnce(metadataResponse()).mockResolvedValueOnce(
      new Response(jwksBody, {
        status: 200,
        headers: {
          'content-encoding': 'gzip',
          'content-length': String(jwksBody.length),
          'content-type': 'application/json',
        },
      }),
    )
    const { verifyAccessToken } = await import('../../src/auth/sso.js')

    await expect(verifyAccessToken(token)).resolves.toEqual({
      characterId: 1404328063,
      characterName: 'Test Character',
      scopes: ['scope.one', 'scope.two'],
    })
  })
})
