import { testClient } from 'hono/testing'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class OwnershipConflict extends Error {}
  return {
    OwnershipConflict,
    attachCharacter: vi.fn(),
    consumeOAuthState: vi.fn(),
    createAuthorizationUrl: vi.fn(),
    deleteSession: vi.fn(),
    exchangeAuthorizationCode: vi.fn(),
    findOwnedCharacter: vi.fn(),
    findSession: vi.fn(),
    getCharacterAffiliation: vi.fn(),
    isSsoConfigured: vi.fn(),
    reauthorizeCharacter: vi.fn(),
    saveLogin: vi.fn(),
    storeOAuthState: vi.fn(),
    verifyAccessToken: vi.fn(),
  }
})

vi.mock('../src/env.js', () => ({
  env: {
    ESI_USER_AGENT: 'EveSpace/Test',
    EVE_CALLBACK_URL: 'http://localhost:8788/auth/eve/callback',
    PORT: 8788,
    SESSION_COOKIE_SECURE: false,
    WEB_ORIGIN: 'http://localhost:3000',
  },
  getSsoConfig: () => ({
    callbackUrl: 'http://localhost:8788/auth/eve/callback',
    clientId: 'test-client',
    clientSecret: 'test-secret',
    encryptionKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    scopes: [],
  }),
  isSsoConfigured: mocks.isSsoConfigured,
}))

vi.mock('../src/auth-store.js', () => ({
  CharacterTokenNotFoundError: class CharacterTokenNotFoundError extends Error {},
  CharacterOwnershipConflictError: mocks.OwnershipConflict,
  attachCharacter: mocks.attachCharacter,
  consumeOAuthState: mocks.consumeOAuthState,
  deleteCharacter: vi.fn(),
  deleteSession: mocks.deleteSession,
  findCharacterToken: vi.fn(),
  findOwnedCharacter: mocks.findOwnedCharacter,
  findSession: mocks.findSession,
  listUserCharacters: vi.fn(),
  reauthorizeCharacter: mocks.reauthorizeCharacter,
  saveLogin: mocks.saveLogin,
  setMainCharacter: vi.fn(),
  storeOAuthState: mocks.storeOAuthState,
  updateCharacterToken: vi.fn(),
}))

vi.mock('../src/eve-sso.js', () => ({
  createAuthorizationUrl: mocks.createAuthorizationUrl,
  exchangeAuthorizationCode: mocks.exchangeAuthorizationCode,
  refreshAccessToken: vi.fn(),
  verifyAccessToken: mocks.verifyAccessToken,
}))

vi.mock('../src/character-profile.js', () => ({
  getCharacterAffiliation: mocks.getCharacterAffiliation,
  getCharacterProfile: vi.fn(),
}))

vi.mock('../src/db/client.js', () => ({ db: {}, sql: vi.fn() }))

import { app } from '../src/index.js'

const client = testClient(app)
const userId = '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c'
const mainCharacter = {
  characterId: 1404328063,
  name: 'Bandera Primary',
  corporationId: 1000166,
  allianceId: null,
  isMain: true,
}
const account = { userId, mainCharacter }

beforeEach(() => {
  mocks.isSsoConfigured.mockReturnValue(true)
  mocks.consumeOAuthState.mockResolvedValue({ intent: 'login' })
  mocks.createAuthorizationUrl.mockImplementation(
    async (state: string) =>
      new URL(`https://login.eveonline.com/v2/oauth/authorize?state=${state}`),
  )
  mocks.exchangeAuthorizationCode.mockResolvedValue({
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_in: 1200,
    token_type: 'Bearer',
  })
  mocks.verifyAccessToken.mockResolvedValue({
    characterId: mainCharacter.characterId,
    characterName: mainCharacter.name,
    scopes: ['esi-wallet.read_character_wallet.v1'],
  })
  mocks.getCharacterAffiliation.mockResolvedValue({
    corporationId: mainCharacter.corporationId,
    allianceId: mainCharacter.allianceId,
  })
  mocks.findSession.mockResolvedValue(account)
  mocks.findOwnedCharacter.mockResolvedValue(mainCharacter)
})

afterEach(() => vi.restoreAllMocks())

describe('EVE SSO start routes', () => {
  test('reports login and authenticated attachment URLs', async () => {
    const response = await client.auth.config.$get()

    expect(await response.json()).toEqual({
      configured: true,
      loginUrl: 'http://localhost:8788/auth/eve/start',
      attachUrl: 'http://localhost:8788/auth/eve/attach',
    })
  })

  test('serves configuration headers without a body for HEAD', async () => {
    const getResponse = await app.request('/auth/config')
    const headResponse = await app.request('/auth/config', { method: 'HEAD' })

    expect(headResponse.status).toBe(getResponse.status)
    expect(headResponse.headers.get('content-type')).toBe(getResponse.headers.get('content-type'))
    expect(headResponse.body).toBeNull()
  })

  test('rejects login start before state is stored when SSO is not configured', async () => {
    mocks.isSsoConfigured.mockReturnValue(false)

    const response = await client.auth.eve.start.$get()

    expect(response.status).toBe(503)
    expect(mocks.storeOAuthState).not.toHaveBeenCalled()
  })

  test('starts login with hash-backed state and a secure callback cookie', async () => {
    const response = await client.auth.eve.start.$get()
    const state = mocks.storeOAuthState.mock.calls[0]?.[0] as string

    expect(response.status).toBe(302)
    expect(state).toHaveLength(43)
    expect(mocks.storeOAuthState).toHaveBeenCalledWith(state, { intent: 'login' })
    expect(mocks.createAuthorizationUrl).toHaveBeenCalledWith(state)
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(response.headers.get('set-cookie')).toContain('SameSite=Lax')
    expect(response.headers.get('set-cookie')).toContain('Priority=High')
  })

  test('requires a session to start attachment', async () => {
    const response = await app.request('/auth/eve/attach')

    expect(response.status).toBe(401)
    expect(mocks.storeOAuthState).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  test('binds attachment state to the active user', async () => {
    const response = await app.request('/auth/eve/attach', { headers: sessionHeader() })
    const state = mocks.storeOAuthState.mock.calls[0]?.[0] as string

    expect(response.status).toBe(302)
    expect(mocks.storeOAuthState).toHaveBeenCalledWith(state, { intent: 'attach', userId })
  })

  test('validates and owns a character before starting reauthorization', async () => {
    const malformed = await app.request('/auth/eve/reauthorize/not-a-number', {
      headers: sessionHeader(),
    })
    expect(malformed.status).toBe(400)
    expect(mocks.findOwnedCharacter).not.toHaveBeenCalled()

    mocks.findOwnedCharacter.mockResolvedValueOnce(null)
    const missing = await app.request('/auth/eve/reauthorize/90000001', {
      headers: sessionHeader(),
    })
    expect(missing.status).toBe(404)
    expect(mocks.storeOAuthState).not.toHaveBeenCalled()
  })

  test('binds reauthorization state to the user and owned character', async () => {
    const response = await app.request(`/auth/eve/reauthorize/${mainCharacter.characterId}`, {
      headers: sessionHeader(),
    })
    const state = mocks.storeOAuthState.mock.calls[0]?.[0] as string

    expect(response.status).toBe(302)
    expect(mocks.storeOAuthState).toHaveBeenCalledWith(state, {
      intent: 'reauthorize',
      userId,
      characterId: mainCharacter.characterId,
    })
  })
})

describe('EVE SSO callback intents', () => {
  test('redirects invalid, mismatched, expired, and replayed state safely', async () => {
    const mismatched = await callbackRequest('query-state', 'cookie-state')
    expect(mismatched.headers.get('location')).toBe('http://localhost:3000/auth?auth=error')
    expect(mocks.consumeOAuthState).not.toHaveBeenCalled()

    mocks.consumeOAuthState.mockResolvedValueOnce(null)
    const replayed = await callbackRequest('valid-state', 'valid-state')
    expect(replayed.status).toBe(302)
    expect(replayed.headers.get('location')).toBe('http://localhost:3000/auth?auth=error')
    expect(replayed.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  test('rejects malformed callback query values before consuming state', async () => {
    const response = await app.request('/auth/eve/callback?state=valid-state&code=')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      message: 'EVE SSO returned an empty authorization code.',
    })
    expect(mocks.consumeOAuthState).not.toHaveBeenCalled()
  })

  test('maps login cancellation and missing code to safe redirects after consuming state', async () => {
    const cancelled = await callbackRequest('valid-state', 'valid-state', 'error=access_denied')
    expect(cancelled.headers.get('location')).toBe('http://localhost:3000/auth?auth=cancelled')
    expect(mocks.exchangeAuthorizationCode).not.toHaveBeenCalled()

    const missingCode = await callbackRequest('valid-state', 'valid-state')
    expect(missingCode.headers.get('location')).toBe('http://localhost:3000/auth?auth=error')
  })

  test('logs in, creates an account session cookie, and redirects to auth success', async () => {
    const response = await callbackRequest('valid-state', 'valid-state', 'code=eve-code')

    expect(response.headers.get('location')).toBe(
      `http://localhost:3000/auth?auth=success&character=${mainCharacter.characterId}`,
    )
    expect(mocks.saveLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: mainCharacter.characterId,
        accessToken: 'access-token',
        sessionToken: expect.any(String),
        sessionExpiresAt: expect.any(Date),
      }),
    )
    expect(mocks.attachCharacter).not.toHaveBeenCalled()
    expect(response.headers.get('set-cookie')).toContain('eve_space_session=')
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
  })

  test('requires the attachment callback session to match its immutable state user', async () => {
    mocks.consumeOAuthState.mockResolvedValue({ intent: 'attach', userId })
    mocks.findSession.mockResolvedValue({ ...account, userId: 'different-user' })

    const response = await callbackRequest('valid-state', 'valid-state', 'code=eve-code', true)

    expect(response.headers.get('location')).toBe('http://localhost:3000/characters?attach=error')
    expect(mocks.exchangeAuthorizationCode).not.toHaveBeenCalled()
    expect(mocks.attachCharacter).not.toHaveBeenCalled()
  })

  test('attaches or refreshes a same-user character without replacing the session or main', async () => {
    mocks.consumeOAuthState.mockResolvedValue({ intent: 'attach', userId })
    mocks.verifyAccessToken.mockResolvedValue({
      characterId: 2112625428,
      characterName: 'Bandera Alt',
      scopes: ['esi-skills.read_skills.v1'],
    })

    const response = await callbackRequest('valid-state', 'valid-state', 'code=eve-code', true)

    expect(mocks.attachCharacter).toHaveBeenCalledWith(
      expect.objectContaining({ userId, characterId: 2112625428 }),
    )
    expect(mocks.saveLogin).not.toHaveBeenCalled()
    expect(response.headers.get('set-cookie')).not.toContain('eve_space_session=')
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/characters?attach=success&character=2112625428',
    )
  })

  test('maps cross-user attachment conflict without exposing the owning account', async () => {
    mocks.consumeOAuthState.mockResolvedValue({ intent: 'attach', userId })
    mocks.attachCharacter.mockRejectedValue(new mocks.OwnershipConflict())

    const response = await callbackRequest('valid-state', 'valid-state', 'code=eve-code', true)

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/characters?attach=conflict',
    )
    expect(response.headers.get('location')).not.toContain(userId)
  })

  test('rejects a wrong-character reauthorization before affiliation or persistence', async () => {
    mocks.consumeOAuthState.mockResolvedValue({
      intent: 'reauthorize',
      userId,
      characterId: mainCharacter.characterId,
    })
    mocks.verifyAccessToken.mockResolvedValue({
      characterId: 2112625428,
      characterName: 'Wrong Character',
      scopes: [],
    })

    const response = await callbackRequest('valid-state', 'valid-state', 'code=eve-code', true)

    expect(response.headers.get('location')).toBe(
      `http://localhost:3000/characters/${mainCharacter.characterId}?reauthorize=error`,
    )
    expect(mocks.getCharacterAffiliation).not.toHaveBeenCalled()
    expect(mocks.reauthorizeCharacter).not.toHaveBeenCalled()
  })

  test('reauthorizes only the state-bound character and preserves the active session', async () => {
    mocks.consumeOAuthState.mockResolvedValue({
      intent: 'reauthorize',
      userId,
      characterId: mainCharacter.characterId,
    })

    const response = await callbackRequest('valid-state', 'valid-state', 'code=eve-code', true)

    expect(mocks.reauthorizeCharacter).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        expectedCharacterId: mainCharacter.characterId,
        characterId: mainCharacter.characterId,
      }),
    )
    expect(response.headers.get('set-cookie')).not.toContain('eve_space_session=')
    expect(response.headers.get('location')).toBe(
      `http://localhost:3000/characters/${mainCharacter.characterId}?reauthorize=success`,
    )
  })

  test('redirects upstream callback failures without exposing details', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.exchangeAuthorizationCode.mockRejectedValue(new Error('secret upstream detail'))

    const response = await callbackRequest('valid-state', 'valid-state', 'code=eve-code')

    expect(response.headers.get('location')).toBe('http://localhost:3000/auth?auth=error')
    expect(response.headers.get('location')).not.toContain('secret')
    expect(mocks.saveLogin).not.toHaveBeenCalled()
  })
})

describe('account sessions', () => {
  test('returns anonymous state without a cookie and clears expired cookies', async () => {
    const anonymous = await client.auth.session.$get()
    expect(await anonymous.json()).toEqual({ authenticated: false })
    expect(mocks.findSession).not.toHaveBeenCalled()

    mocks.findSession.mockResolvedValueOnce(null)
    const expired = await client.auth.session.$get({}, { headers: sessionHeader() })
    expect(await expired.json()).toEqual({ authenticated: false })
    expect(expired.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  test('returns user identity with a nested current-main summary and private headers', async () => {
    const response = await client.auth.session.$get({}, { headers: sessionHeader() })

    expect(await response.json()).toEqual({ authenticated: true, account })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toBe('Cookie, Origin')
  })

  test('deletes persisted and browser sessions on logout', async () => {
    const response = await client.auth.logout.$post({}, { headers: sessionHeader() })

    expect(response.status).toBe(204)
    expect(mocks.deleteSession).toHaveBeenCalledWith('active-session')
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})

function callbackRequest(state: string, cookieState: string, query = '', withSession = false) {
  const suffix = query ? `&${query}` : ''
  const cookie = `eve_space_oauth_state=${cookieState}${
    withSession ? '; eve_space_session=active-session' : ''
  }`
  return app.request(`/auth/eve/callback?state=${state}${suffix}`, {
    headers: { Cookie: cookie },
  })
}

function sessionHeader() {
  return { Cookie: 'eve_space_session=active-session' }
}
