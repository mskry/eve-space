import { testClient } from 'hono/testing'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class ApprovalRequired extends Error {}
  class TransferFailure extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  }
  return {
    ApprovalRequired,
    TransferFailure,
    attachCharacter: vi.fn(),
    assertOrganizationOwnerDirectorRole: vi.fn(),
    assertOrganizationOwnerScope: vi.fn(),
    claimOrganizationOwnership: vi.fn(),
    consumeOAuthState: vi.fn(),
    createAuthorizationUrl: vi.fn(),
    deleteSession: vi.fn(),
    exchangeAuthorizationCode: vi.fn(),
    findOwnedCharacter: vi.fn(),
    findSession: vi.fn(),
    getCharacterAffiliation: vi.fn(),
    observeCharacterAffiliation: vi.fn(),
    getCharacterCorporationRoles: vi.fn(),
    loadCurrentOrganizationIdentity: vi.fn(),
    loadTransferApprovalForStart: vi.fn(),
    isSsoConfigured: vi.fn(),
    reauthorizeCharacter: vi.fn(),
    resolveOrganizationAuthorityCorporation: vi.fn(),
    saveLogin: vi.fn(),
    storeOAuthState: vi.fn(),
    transferCharacter: vi.fn(),
    verifyAccessToken: vi.fn(),
  }
})

vi.mock('../../src/env.js', () => ({
  env: {
    NODE_ENV: 'development',
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

vi.mock('../../src/auth/character-lifecycle.js', () => ({
  CharacterTransferApprovalRequiredError: mocks.ApprovalRequired,
  attachCharacter: mocks.attachCharacter,
  deleteCharacter: vi.fn(),
  findOwnedCharacter: mocks.findOwnedCharacter,
  listUserCharacters: vi.fn(),
  reauthorizeCharacter: mocks.reauthorizeCharacter,
  saveLogin: mocks.saveLogin,
  setMainCharacter: vi.fn(),
}))

vi.mock('../../src/auth/oauth-state-store.js', () => ({
  consumeOAuthState: mocks.consumeOAuthState,
  storeOAuthState: mocks.storeOAuthState,
}))

vi.mock('../../src/auth/character-transfer-approvals.js', () => ({
  loadTransferApprovalForStart: mocks.loadTransferApprovalForStart,
}))

vi.mock('../../src/auth/character-transfer.js', () => ({
  CharacterTransferError: mocks.TransferFailure,
  transferCharacter: mocks.transferCharacter,
}))

vi.mock('../../src/auth/session-store.js', () => ({
  deleteSession: mocks.deleteSession,
  findSession: mocks.findSession,
}))

vi.mock('../../src/auth/sso.js', () => ({
  createAuthorizationUrl: mocks.createAuthorizationUrl,
  exchangeAuthorizationCode: mocks.exchangeAuthorizationCode,
  refreshAccessToken: vi.fn(),
  verifyAccessToken: mocks.verifyAccessToken,
}))

vi.mock('../../src/characters/profile.js', () => ({
  getCharacterAffiliation: mocks.getCharacterAffiliation,
  getCharacterProfile: vi.fn(),
}))

vi.mock('../../src/characters/affiliation-sync.js', () => ({
  observeCharacterAffiliation: mocks.observeCharacterAffiliation,
}))

vi.mock('../../src/characters/corporation-roles.js', () => ({
  characterCorporationRolesScope: 'esi-characters.read_corporation_roles.v1',
  getCharacterCorporationRoles: mocks.getCharacterCorporationRoles,
}))

vi.mock('../../src/organization/context.js', () => ({
  loadCurrentOrganizationIdentity: mocks.loadCurrentOrganizationIdentity,
}))

vi.mock('../../src/organization/authority.js', () => ({
  resolveOrganizationAuthorityCorporation: mocks.resolveOrganizationAuthorityCorporation,
}))

vi.mock('../../src/organization/authority-policy.js', () => ({
  OrganizationAuthorityError: class OrganizationAuthorityError extends Error {},
  assertOrganizationOwnerDirectorRole: mocks.assertOrganizationOwnerDirectorRole,
  assertOrganizationOwnerScope: mocks.assertOrganizationOwnerScope,
}))

vi.mock('../../src/organization/owner-claim.js', () => ({
  OrganizationOwnerClaimError: class OrganizationOwnerClaimError extends Error {},
  claimOrganizationOwnership: mocks.claimOrganizationOwnership,
}))

vi.mock('../../src/db/client.js', () => ({ db: {}, sql: vi.fn() }))

import { app } from '../../src/index.js'
import { env } from '../../src/env.js'
import { apiLogger } from '../../src/logging.js'

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
const transferApprovalId = '66503848-72b8-4fa3-8af5-de056001a37e'
const transferSourceUserId = '115c2738-0d19-4903-8a60-295800e20c0a'
const transferSourceSubjectLifecycleId = '2eb78a4f-9309-4b49-a852-9cbaf32ec227'
const ownerClaimSubjectLifecycleId = '8c069b76-e15f-4084-9f76-1aba185dd94b'

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
  mocks.observeCharacterAffiliation.mockResolvedValue({
    characterId: mainCharacter.characterId,
    corporationId: mainCharacter.corporationId,
    allianceId: mainCharacter.allianceId,
    affiliationCheckedAt: new Date('2026-08-31T12:00:00Z'),
    stale: false,
  })
  mocks.getCharacterCorporationRoles.mockResolvedValue({
    roles: ['Director'],
    rolesAtBase: [],
    rolesAtHeadquarters: [],
    rolesAtOther: [],
  })
  mocks.reauthorizeCharacter.mockResolvedValue({
    affiliationCheckedAt: new Date('2026-08-31T12:00:00Z'),
    subjectLifecycleId: ownerClaimSubjectLifecycleId,
  })
  mocks.resolveOrganizationAuthorityCorporation.mockResolvedValue(mainCharacter.corporationId)
  mocks.findSession.mockResolvedValue(account)
  mocks.findOwnedCharacter.mockResolvedValue(mainCharacter)
  mocks.loadCurrentOrganizationIdentity.mockResolvedValue({
    deploymentId: 1,
    organizationType: 'corporation',
    organizationId: mainCharacter.corporationId,
    organizationVersion: 1,
  })
  mocks.loadTransferApprovalForStart.mockResolvedValue({
    approvalId: transferApprovalId,
    sourceUserId: transferSourceUserId,
    sourceSubjectLifecycleId: transferSourceSubjectLifecycleId,
    userId,
    characterId: 2_112_625_428,
  })
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

    const response = await client.auth.eve.start.$get({ query: {} })

    expect(response.status).toBe(503)
    expect(mocks.storeOAuthState).not.toHaveBeenCalled()
  })

  test('starts login with hash-backed state and a secure callback cookie', async () => {
    const response = await client.auth.eve.start.$get({ query: {} })
    const state = mocks.storeOAuthState.mock.calls[0]?.[0] as string

    expect(response.status).toBe(302)
    expect(state).toHaveLength(43)
    expect(mocks.storeOAuthState).toHaveBeenCalledWith(state, { intent: 'login' })
    expect(mocks.createAuthorizationUrl).toHaveBeenCalledWith(state, expect.any(AbortSignal))
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(response.headers.get('set-cookie')).toContain('SameSite=Lax')
    expect(response.headers.get('set-cookie')).toContain('Priority=High')
  })

  test('uses the issued application session for immediate attachment authorization', async () => {
    const response = await client.auth.eve.start.$get({ query: {} }, { headers: sessionHeader() })
    const state = mocks.storeOAuthState.mock.calls[0]?.[0] as string

    expect(response.status).toBe(302)
    expect(mocks.findSession).toHaveBeenCalledWith('active-session')
    expect(mocks.storeOAuthState).toHaveBeenCalledWith(state, { intent: 'attach', userId })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  test('ignores a login return path when an authenticated browser follows a stale login link', async () => {
    const returnTo = `/characters/${mainCharacter.characterId}?tab=wallet#activity`

    const response = await client.auth.eve.start.$get(
      { query: { returnTo } },
      { headers: sessionHeader() },
    )

    expect(response.status).toBe(302)
    expect(mocks.storeOAuthState).toHaveBeenCalledWith(expect.any(String), {
      intent: 'attach',
      userId,
    })
  })

  test('keeps login intent for an expired, revoked, or unknown application session', async () => {
    mocks.findSession.mockResolvedValueOnce(null)

    const response = await client.auth.eve.start.$get({ query: {} }, { headers: sessionHeader() })

    expect(response.status).toBe(302)
    expect(mocks.storeOAuthState).toHaveBeenCalledWith(expect.any(String), { intent: 'login' })
  })

  test('stores a validated login return path in OAuth state', async () => {
    const returnTo = `/characters/${mainCharacter.characterId}?tab=wallet#activity`

    const response = await client.auth.eve.start.$get({ query: { returnTo } })
    const state = mocks.storeOAuthState.mock.calls[0]?.[0] as string

    expect(response.status).toBe(302)
    expect(mocks.storeOAuthState).toHaveBeenCalledWith(state, {
      intent: 'login',
      returnPath: returnTo,
    })
  })

  test.each([
    ['an external destination', 'https://example.com/characters/7'],
    ['a protocol-relative destination', '//example.com/characters/7'],
    ['the authorization route', '/auth'],
    ['an encoded authorization route', '/%61uth'],
    ['a duplicate destination query', '/characters/7/mail?label=1&label=2'],
  ])('rejects %s before storing login state', async (_label, returnTo) => {
    const response = await app.request(`/auth/eve/start?returnTo=${encodeURIComponent(returnTo)}`)

    expect(response.status).toBe(400)
    expect(mocks.storeOAuthState).not.toHaveBeenCalled()
  })

  test('rejects repeated login return paths', async () => {
    const response = await app.request(
      '/auth/eve/start?returnTo=%2Fcharacters%2F7&returnTo=%2Fcharacters%2F8',
    )

    expect(response.status).toBe(400)
    expect(mocks.storeOAuthState).not.toHaveBeenCalled()
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

  test('starts transfer SSO only from an authenticated trusted-origin POST', async () => {
    const response = await transferStartRequest()
    const state = mocks.storeOAuthState.mock.calls[0]?.[0] as string

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      authorizationUrl: `https://login.eveonline.com/v2/oauth/authorize?state=${state}`,
    })
    expect(mocks.loadTransferApprovalForStart).toHaveBeenCalledWith({
      approvalId: transferApprovalId,
      secret: 'transfer-link-secret-value-that-is-long-enough',
      destinationUserId: userId,
    })
    expect(mocks.storeOAuthState).toHaveBeenCalledWith(state, {
      intent: 'transfer',
      approvalId: transferApprovalId,
      sourceUserId: transferSourceUserId,
      sourceSubjectLifecycleId: transferSourceSubjectLifecycleId,
      userId,
      characterId: 2_112_625_428,
    })
    expect(response.headers.get('set-cookie')).toContain('eve_space_oauth_state=')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  test.each(['GET', 'HEAD'])('%s transfer-link inspection cannot start SSO', async (method) => {
    const response = await app.request('/auth/eve/transfer', {
      method,
      headers: sessionHeader(),
    })

    expect(response.status).toBe(404)
    expect(mocks.loadTransferApprovalForStart).not.toHaveBeenCalled()
    expect(mocks.storeOAuthState).not.toHaveBeenCalled()
    expect(mocks.createAuthorizationUrl).not.toHaveBeenCalled()
  })

  test('does not inspect or start transfer SSO without destination authentication or trusted origin', async () => {
    const anonymous = await transferStartRequest({ session: false })
    expect(anonymous.status).toBe(401)
    expect(mocks.loadTransferApprovalForStart).not.toHaveBeenCalled()

    const untrusted = await transferStartRequest({ origin: 'https://attacker.invalid' })
    expect(untrusted.status).toBe(403)
    expect(mocks.loadTransferApprovalForStart).not.toHaveBeenCalled()
    expect(mocks.storeOAuthState).not.toHaveBeenCalled()
  })

  test('returns generic guidance without OAuth state for a wrong account or unusable link', async () => {
    mocks.loadTransferApprovalForStart.mockResolvedValueOnce(null)

    const response = await transferStartRequest()

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      code: 'TRANSFER_APPROVAL_UNUSABLE',
      message: 'Transfer approval is no longer usable.',
    })
    expect(mocks.storeOAuthState).not.toHaveBeenCalled()
  })

  test('does not expose a transfer-link secret through failure telemetry', async () => {
    const secret = 'transfer-link-secret-value-that-is-long-enough'
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {})
    apiLogger.enableLogging()
    mocks.loadTransferApprovalForStart.mockRejectedValueOnce(new Error(secret))

    try {
      const response = await transferStartRequest()

      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ message: 'Internal server error' })
      expect(JSON.stringify([...consoleError.mock.calls, ...consoleInfo.mock.calls])).not.toContain(
        secret,
      )
    } finally {
      apiLogger.disableLogging()
      consoleError.mockRestore()
      consoleInfo.mockRestore()
    }
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

  test('binds an owner claim to the session, exact owned character, and current organization', async () => {
    const response = await app.request(
      `/auth/eve/claim-organization-owner/${mainCharacter.characterId}`,
      { headers: sessionHeader() },
    )
    const state = mocks.storeOAuthState.mock.calls[0]?.[0] as string

    expect(response.status).toBe(302)
    expect(mocks.storeOAuthState).toHaveBeenCalledWith(state, {
      intent: 'claim-organization-owner',
      userId,
      characterId: mainCharacter.characterId,
      organizationId: mainCharacter.corporationId,
      organizationVersion: 1,
    })
  })

  test('requires ownership before reading organization context for an owner claim', async () => {
    mocks.findOwnedCharacter.mockResolvedValueOnce(null)
    const response = await app.request('/auth/eve/claim-organization-owner/90000001', {
      headers: sessionHeader(),
    })

    expect(response.status).toBe(404)
    expect(mocks.loadCurrentOrganizationIdentity).not.toHaveBeenCalled()
    expect(mocks.storeOAuthState).not.toHaveBeenCalled()
  })

  test('persists a normalized same-character mailbox return with a safe query', async () => {
    const returnTo = `/characters/${mainCharacter.characterId}/mail?label=7&unread=true`
    const response = await reauthorizationRequest(returnTo)
    const state = mocks.storeOAuthState.mock.calls[0]?.[0] as string

    expect(response.status).toBe(302)
    expect(mocks.storeOAuthState).toHaveBeenCalledWith(state, {
      intent: 'reauthorize',
      userId,
      characterId: mainCharacter.characterId,
      returnPath: returnTo,
    })
  })

  test('accepts a return destination at the exact 512-character bound', async () => {
    const prefix = `/characters/${mainCharacter.characterId}/`
    const returnTo = `${prefix}${'a'.repeat(512 - prefix.length)}`

    const response = await reauthorizationRequest(returnTo)

    expect(response.status).toBe(302)
    expect(mocks.storeOAuthState).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ returnPath: returnTo }),
    )
  })

  test.each([
    ['empty', ''],
    ['over 512 characters', `/characters/${mainCharacter.characterId}/${'a'.repeat(500)}`],
    ['external URL', 'https://example.com/characters/1404328063/mail'],
    ['protocol-relative URL', '//example.com/characters/1404328063/mail'],
    ['missing leading slash', `characters/${mainCharacter.characterId}/mail`],
    ['backslash', `/characters/${mainCharacter.characterId}\\mail`],
    ['ASCII control', `/characters/${mainCharacter.characterId}/mail\u0000`],
    ['whitespace', `/characters/${mainCharacter.characterId}/mail box`],
    ['ambiguous plus', `/characters/${mainCharacter.characterId}/mail?search=a+b`],
    ['malformed percent encoding', `/characters/${mainCharacter.characterId}/mail%ZZ`],
    ['fragment', `/characters/${mainCharacter.characterId}/mail#message`],
    ['encoded fragment', `/characters/${mainCharacter.characterId}/mail%23message`],
    ['foreign character', '/characters/2112625428/mail'],
    ['similar character ID', `/characters/${mainCharacter.characterId}0/mail`],
    ['raw traversal', `/characters/${mainCharacter.characterId}/mail/../settings`],
    ['encoded traversal', `/characters/${mainCharacter.characterId}/mail/%2e%2e/settings`],
    [
      'double-encoded traversal',
      `/characters/${mainCharacter.characterId}/mail/%252e%252e/settings`,
    ],
    ['encoded separator', `/characters/${mainCharacter.characterId}/mail%2Fsettings`],
    ['double-encoded separator', `/characters/${mainCharacter.characterId}/mail%252Fsettings`],
    ['encoded backslash', `/characters/${mainCharacter.characterId}/mail%5Csettings`],
    [
      'duplicate destination query',
      `/characters/${mainCharacter.characterId}/mail?label=1&label=2`,
    ],
    [
      'normalization over 512 characters',
      `/characters/${mainCharacter.characterId}/${'é'.repeat(100)}`,
    ],
  ])(
    'rejects an invalid %s return before session, ownership, state, or EVE URL work',
    async (_name, returnTo) => {
      const response = await reauthorizationRequest(returnTo)

      expect(response.status).toBe(400)
      expect(mocks.findSession).not.toHaveBeenCalled()
      expect(mocks.findOwnedCharacter).not.toHaveBeenCalled()
      expect(mocks.storeOAuthState).not.toHaveBeenCalled()
      expect(mocks.createAuthorizationUrl).not.toHaveBeenCalled()
    },
  )

  test('rejects duplicate returnTo parameters before session or authorization work', async () => {
    const first = encodeURIComponent(`/characters/${mainCharacter.characterId}/mail`)
    const second = encodeURIComponent(`/characters/${mainCharacter.characterId}`)
    const response = await app.request(
      `/auth/eve/reauthorize/${mainCharacter.characterId}?returnTo=${first}&returnTo=${second}`,
      { headers: sessionHeader() },
    )

    expect(response.status).toBe(400)
    expect(mocks.findSession).not.toHaveBeenCalled()
    expect(mocks.findOwnedCharacter).not.toHaveBeenCalled()
    expect(mocks.storeOAuthState).not.toHaveBeenCalled()
    expect(mocks.createAuthorizationUrl).not.toHaveBeenCalled()
  })
})

describe('EVE SSO callback intents', () => {
  test('attaches a second character immediately after first login using the issued session cookie', async () => {
    const firstCallback = await callbackRequest('login-state', 'login-state', 'code=first-code')
    const issuedSessionCookie = cookiePair(firstCallback, 'eve_space_session')

    mocks.storeOAuthState.mockClear()
    const secondStart = await app.request('/auth/eve/start', {
      headers: { Cookie: issuedSessionCookie },
    })
    const attachmentState = mocks.storeOAuthState.mock.calls[0]?.[0] as string

    expect(secondStart.status).toBe(302)
    expect(mocks.storeOAuthState).toHaveBeenCalledWith(attachmentState, {
      intent: 'attach',
      userId,
    })

    mocks.consumeOAuthState.mockResolvedValueOnce({ intent: 'attach', userId })
    mocks.verifyAccessToken.mockResolvedValueOnce({
      characterId: 2_112_625_428,
      characterName: 'Bandera Alt',
      scopes: ['esi-skills.read_skills.v1'],
    })
    const secondCallback = await callbackRequest(
      attachmentState,
      attachmentState,
      'code=second-code',
      issuedSessionCookie,
    )

    expect(mocks.saveLogin).toHaveBeenCalledOnce()
    expect(mocks.attachCharacter).toHaveBeenCalledOnce()
    expect(mocks.attachCharacter).toHaveBeenCalledWith(
      expect.objectContaining({ userId, characterId: 2_112_625_428 }),
    )
    expect(secondCallback.headers.get('set-cookie')).not.toContain('eve_space_session=')
    expect(secondCallback.headers.get('location')).toBe(
      'http://localhost:3000/characters?attach=success&character=2112625428',
    )
  })

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
    const requestSignal = mocks.exchangeAuthorizationCode.mock.calls[0]?.[1]

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
    expect(requestSignal).toBeInstanceOf(AbortSignal)
    expect(mocks.verifyAccessToken).toHaveBeenCalledWith('access-token', requestSignal)
    expect(response.headers.get('set-cookie')).toContain('eve_space_session=')
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
  })

  test('returns a successful login to its state-bound deep link', async () => {
    const returnPath = `/characters/${mainCharacter.characterId}?tab=wallet#activity`
    mocks.consumeOAuthState.mockResolvedValue({ intent: 'login', returnPath })

    const response = await callbackRequest('valid-state', 'valid-state', 'code=eve-code')

    expect(response.headers.get('location')).toBe(
      `http://localhost:3000/auth?auth=success&character=${mainCharacter.characterId}&redirect=%2Fcharacters%2F${mainCharacter.characterId}%3Ftab%3Dwallet%23activity`,
    )
  })

  test('requires the attachment callback session to match its immutable state user', async () => {
    mocks.consumeOAuthState.mockResolvedValue({ intent: 'attach', userId })
    mocks.findSession.mockResolvedValue({ ...account, userId: 'different-user' })

    const response = await callbackRequest('valid-state', 'valid-state', 'code=eve-code', true)

    expect(response.headers.get('location')).toBe('http://localhost:3000/characters?attach=error')
    expect(mocks.exchangeAuthorizationCode).not.toHaveBeenCalled()
    expect(mocks.attachCharacter).not.toHaveBeenCalled()
  })

  test('transfers only the exact state-bound character without replacing the destination session', async () => {
    mocks.consumeOAuthState.mockResolvedValue(transferState())
    mocks.verifyAccessToken.mockResolvedValue({
      characterId: 2_112_625_428,
      characterName: 'Bandera Alt',
      scopes: ['esi-skills.read_skills.v1'],
    })

    const response = await callbackRequest('valid-state', 'valid-state', 'code=eve-code', true)

    expect(mocks.transferCharacter).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalId: transferApprovalId,
        sourceUserId: transferSourceUserId,
        sourceSubjectLifecycleId: transferSourceSubjectLifecycleId,
        destinationUserId: userId,
        destinationSessionToken: 'active-session',
        characterId: 2_112_625_428,
        authorization: expect.objectContaining({
          characterId: 2_112_625_428,
          accessToken: 'access-token',
        }),
      }),
    )
    expect(mocks.saveLogin).not.toHaveBeenCalled()
    expect(mocks.attachCharacter).not.toHaveBeenCalled()
    expect(response.headers.get('set-cookie')).not.toContain('eve_space_session=')
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/characters?attach=success&character=2112625428',
    )
  })

  test.each([
    ['missing', null],
    ['changed', { ...account, userId: 'different-user' }],
  ])(
    'maps a %s transfer-bound session to safe unusable-approval feedback',
    async (_name, session) => {
      mocks.consumeOAuthState.mockResolvedValue(transferState())
      mocks.findSession.mockResolvedValue(session)

      const response = await callbackRequest('valid-state', 'valid-state', 'code=eve-code', true)

      expect(response.headers.get('location')).toBe(
        'http://localhost:3000/characters?attach=approval-unusable',
      )
      expect(mocks.exchangeAuthorizationCode).not.toHaveBeenCalled()
      expect(mocks.transferCharacter).not.toHaveBeenCalled()
      expect(mocks.saveLogin).not.toHaveBeenCalled()
      expect(mocks.attachCharacter).not.toHaveBeenCalled()
      expect(mocks.reauthorizeCharacter).not.toHaveBeenCalled()
    },
  )

  test('preserves transfer cancellation and general failure redirects', async () => {
    mocks.consumeOAuthState.mockResolvedValueOnce(transferState())
    const cancelled = await callbackRequest(
      'valid-state',
      'valid-state',
      'error=access_denied',
      true,
    )
    expect(cancelled.headers.get('location')).toBe(
      'http://localhost:3000/characters?attach=cancelled',
    )
    expect(mocks.saveLogin).not.toHaveBeenCalled()
    expect(mocks.attachCharacter).not.toHaveBeenCalled()
    expect(mocks.reauthorizeCharacter).not.toHaveBeenCalled()

    mocks.consumeOAuthState.mockResolvedValueOnce(transferState())
    const failed = await callbackRequest('valid-state', 'valid-state', undefined, true)
    expect(failed.headers.get('location')).toBe('http://localhost:3000/characters?attach=error')
    expect(mocks.exchangeAuthorizationCode).not.toHaveBeenCalled()
    expect(mocks.transferCharacter).not.toHaveBeenCalled()
  })

  test('consumes failed transfer state once without invoking another persistence path', async () => {
    mocks.consumeOAuthState
      .mockResolvedValueOnce(transferState(mainCharacter.characterId))
      .mockResolvedValueOnce(null)
    mocks.transferCharacter.mockRejectedValueOnce(new Error('transfer persistence failed'))

    const failed = await callbackRequest('valid-state', 'valid-state', 'code=eve-code', true)
    const replayed = await callbackRequest('valid-state', 'valid-state', 'code=eve-code', true)

    expect(failed.headers.get('location')).toBe('http://localhost:3000/characters?attach=error')
    expect(failed.headers.get('set-cookie')).not.toContain('eve_space_session=')
    expect(replayed.headers.get('location')).toBe('http://localhost:3000/auth?auth=error')
    expect(mocks.exchangeAuthorizationCode).toHaveBeenCalledOnce()
    expect(mocks.transferCharacter).toHaveBeenCalledOnce()
    expect(mocks.saveLogin).not.toHaveBeenCalled()
    expect(mocks.attachCharacter).not.toHaveBeenCalled()
    expect(mocks.reauthorizeCharacter).not.toHaveBeenCalled()
  })

  test('rejects a wrong transfer character before affiliation or persistence', async () => {
    mocks.consumeOAuthState.mockResolvedValue(transferState())

    const response = await callbackRequest('valid-state', 'valid-state', 'code=eve-code', true)

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/characters?attach=approval-unusable',
    )
    expect(mocks.getCharacterAffiliation).not.toHaveBeenCalled()
    expect(mocks.transferCharacter).not.toHaveBeenCalled()
    expect(mocks.saveLogin).not.toHaveBeenCalled()
    expect(mocks.attachCharacter).not.toHaveBeenCalled()
    expect(mocks.reauthorizeCharacter).not.toHaveBeenCalled()
  })

  test.each([
    ['main-character', 'main-character'],
    ['authority-evidence', 'authority-evidence'],
    ['corporation-source', 'corporation-source'],
    ['approval-unusable', 'approval-unusable'],
  ])('maps transfer blocker %s to safe roster feedback', async (code, status) => {
    mocks.consumeOAuthState.mockResolvedValue(transferState(mainCharacter.characterId))
    mocks.transferCharacter.mockRejectedValue(new mocks.TransferFailure(code))

    const response = await callbackRequest('valid-state', 'valid-state', 'code=eve-code', true)

    expect(response.headers.get('location')).toBe(
      `http://localhost:3000/characters?attach=${status}`,
    )
  })

  test.each([
    ['expires', 'approval-unusable'],
    ['is revoked', 'approval-unusable'],
    ['loses its destination session', 'approval-unusable'],
  ])('maps a transfer approval that %s during SSO to safe feedback', async (_name, code) => {
    mocks.consumeOAuthState.mockResolvedValue(transferState(mainCharacter.characterId))
    mocks.transferCharacter.mockRejectedValue(new mocks.TransferFailure(code))

    const response = await callbackRequest('valid-state', 'valid-state', 'code=eve-code', true)

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/characters?attach=approval-unusable',
    )
    expect(mocks.exchangeAuthorizationCode).toHaveBeenCalledOnce()
    expect(mocks.verifyAccessToken).toHaveBeenCalledOnce()
    expect(mocks.transferCharacter).toHaveBeenCalledOnce()
    expect(mocks.saveLogin).not.toHaveBeenCalled()
    expect(mocks.attachCharacter).not.toHaveBeenCalled()
    expect(mocks.reauthorizeCharacter).not.toHaveBeenCalled()
  })

  test('requires an owner-claim callback session to match its immutable state user', async () => {
    mocks.consumeOAuthState.mockResolvedValue({
      intent: 'claim-organization-owner',
      userId,
      characterId: mainCharacter.characterId,
      organizationId: mainCharacter.corporationId,
      organizationVersion: 1,
    })
    mocks.findSession.mockResolvedValue({ ...account, userId: 'different-user' })

    const response = await callbackRequest('valid-state', 'valid-state', 'code=eve-code', true)

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/settings/integrations?organizationOwner=error',
    )
    expect(mocks.exchangeAuthorizationCode).not.toHaveBeenCalled()
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

  test('requires approval for cross-user attachment without exposing the owning account', async () => {
    mocks.consumeOAuthState.mockResolvedValue({ intent: 'attach', userId })
    mocks.attachCharacter.mockRejectedValue(new mocks.ApprovalRequired())

    const response = await callbackRequest('valid-state', 'valid-state', 'code=eve-code', true)

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/characters?attach=approval-required',
    )
    expect(response.headers.get('location')).not.toContain(userId)
  })

  test('does not broaden specialized callback errors beyond their stored intents', async () => {
    mocks.consumeOAuthState.mockResolvedValueOnce({ intent: 'attach', userId })
    mocks.attachCharacter.mockRejectedValueOnce(new mocks.TransferFailure('main-character'))

    const attachment = await callbackRequest('valid-state', 'valid-state', 'code=eve-code', true)
    expect(attachment.headers.get('location')).toBe('http://localhost:3000/characters?attach=error')

    mocks.consumeOAuthState.mockResolvedValueOnce({
      intent: 'reauthorize',
      userId,
      characterId: mainCharacter.characterId,
    })
    mocks.reauthorizeCharacter.mockRejectedValueOnce(new mocks.ApprovalRequired())

    const reauthorization = await callbackRequest(
      'valid-state',
      'valid-state',
      'code=eve-code',
      true,
    )
    expect(reauthorization.headers.get('location')).toBe(
      `http://localhost:3000/characters/${mainCharacter.characterId}?reauthorize=error`,
    )
  })

  test.each([
    ['login', { intent: 'login' as const }, [1, 0, 0]],
    ['attachment', { intent: 'attach' as const, userId }, [0, 1, 0]],
    [
      'reauthorization',
      { intent: 'reauthorize' as const, userId, characterId: mainCharacter.characterId },
      [0, 0, 1],
    ],
  ])(
    'does not upgrade %s state with forged transfer callback parameters',
    async (_name, state, expectedWriterCalls) => {
      mocks.consumeOAuthState.mockResolvedValue(state)
      const forgedParameters = new URLSearchParams({
        code: 'eve-code',
        approvalId: transferApprovalId,
        secret: 'forged-transfer-secret',
        intent: 'transfer',
        sourceUserId: transferSourceUserId,
        sourceSubjectLifecycleId: transferSourceSubjectLifecycleId,
        characterId: String(mainCharacter.characterId),
      })

      await callbackRequest('valid-state', 'valid-state', forgedParameters.toString(), true)

      expect(mocks.transferCharacter).not.toHaveBeenCalled()
      expect([
        mocks.saveLogin.mock.calls.length,
        mocks.attachCharacter.mock.calls.length,
        mocks.reauthorizeCharacter.mock.calls.length,
      ]).toEqual(expectedWriterCalls)
    },
  )

  test('rejects a wrong-character reauthorization before affiliation or persistence', async () => {
    mocks.consumeOAuthState.mockResolvedValue({
      intent: 'reauthorize',
      userId,
      characterId: mainCharacter.characterId,
      returnPath: `/characters/${mainCharacter.characterId}/mail?label=7`,
    })
    mocks.verifyAccessToken.mockResolvedValue({
      characterId: 2112625428,
      characterName: 'Wrong Character',
      scopes: [],
    })

    const response = await callbackRequest('valid-state', 'valid-state', 'code=eve-code', true)

    expect(response.headers.get('location')).toBe(
      `http://localhost:3000/characters/${mainCharacter.characterId}/mail?label=7&reauthorize=error`,
    )
    expect(mocks.getCharacterAffiliation).not.toHaveBeenCalled()
    expect(mocks.reauthorizeCharacter).not.toHaveBeenCalled()
  })

  test('rejects a wrong-character owner claim before affiliation or persistence', async () => {
    mocks.consumeOAuthState.mockResolvedValue({
      intent: 'claim-organization-owner',
      userId,
      characterId: mainCharacter.characterId,
      organizationId: mainCharacter.corporationId,
      organizationVersion: 1,
    })
    mocks.verifyAccessToken.mockResolvedValue({
      characterId: 2_112_625_428,
      characterName: 'Wrong Character',
      scopes: [],
    })

    const response = await callbackRequest('valid-state', 'valid-state', 'code=eve-code', true)

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/settings/integrations?organizationOwner=error',
    )
    expect(mocks.getCharacterAffiliation).not.toHaveBeenCalled()
    expect(mocks.reauthorizeCharacter).not.toHaveBeenCalled()
  })

  test('reauthorizes and atomically persists a verified owner claim', async () => {
    mocks.consumeOAuthState.mockResolvedValue({
      intent: 'claim-organization-owner',
      userId,
      characterId: mainCharacter.characterId,
      organizationId: mainCharacter.corporationId,
      organizationVersion: 1,
    })
    mocks.verifyAccessToken.mockResolvedValue({
      characterId: mainCharacter.characterId,
      characterName: mainCharacter.name,
      scopes: ['esi-characters.read_corporation_roles.v1'],
    })

    const response = await callbackRequest('valid-state', 'valid-state', 'code=eve-code', true)

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/settings/integrations?organizationOwner=success',
    )
    expect(mocks.saveLogin).not.toHaveBeenCalled()
    expect(mocks.attachCharacter).not.toHaveBeenCalled()
    expect(mocks.reauthorizeCharacter).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        expectedCharacterId: mainCharacter.characterId,
        characterId: mainCharacter.characterId,
      }),
    )
    expect(mocks.observeCharacterAffiliation).toHaveBeenCalledWith(mainCharacter.characterId)
    expect(mocks.getCharacterCorporationRoles).toHaveBeenCalledWith(
      mainCharacter.characterId,
      ownerClaimSubjectLifecycleId,
    )
    expect(mocks.claimOrganizationOwnership).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        characterId: mainCharacter.characterId,
        subjectLifecycleId: ownerClaimSubjectLifecycleId,
        organizationId: mainCharacter.corporationId,
        organizationVersion: 1,
        authorityCorporationId: mainCharacter.corporationId,
        requiredScope: 'esi-characters.read_corporation_roles.v1',
      }),
    )
  })

  test('rejects stale owner-claim affiliation before token persistence', async () => {
    mocks.consumeOAuthState.mockResolvedValue({
      intent: 'claim-organization-owner',
      userId,
      characterId: mainCharacter.characterId,
      organizationId: mainCharacter.corporationId,
      organizationVersion: 1,
    })
    mocks.observeCharacterAffiliation.mockResolvedValue({
      characterId: mainCharacter.characterId,
      corporationId: mainCharacter.corporationId,
      allianceId: null,
      affiliationCheckedAt: new Date('2026-08-31T12:00:00Z'),
      stale: true,
    })

    const response = await callbackRequest('valid-state', 'valid-state', 'code=eve-code', true)

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/settings/integrations?organizationOwner=error',
    )
    expect(mocks.reauthorizeCharacter).not.toHaveBeenCalled()
    expect(mocks.claimOrganizationOwnership).not.toHaveBeenCalled()
  })

  test('rejects stale organization state before token persistence', async () => {
    mocks.consumeOAuthState.mockResolvedValue({
      intent: 'claim-organization-owner',
      userId,
      characterId: mainCharacter.characterId,
      organizationId: mainCharacter.corporationId,
      organizationVersion: 1,
    })
    mocks.loadCurrentOrganizationIdentity.mockResolvedValue({
      deploymentId: 1,
      organizationType: 'corporation',
      organizationId: mainCharacter.corporationId,
      organizationVersion: 2,
    })

    const response = await callbackRequest('valid-state', 'valid-state', 'code=eve-code', true)

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/settings/integrations?organizationOwner=error',
    )
    expect(mocks.reauthorizeCharacter).not.toHaveBeenCalled()
    expect(mocks.claimOrganizationOwnership).not.toHaveBeenCalled()
  })

  test('does not persist an owner grant when current EVE roles lack Director', async () => {
    mocks.consumeOAuthState.mockResolvedValue({
      intent: 'claim-organization-owner',
      userId,
      characterId: mainCharacter.characterId,
      organizationId: mainCharacter.corporationId,
      organizationVersion: 1,
    })
    mocks.verifyAccessToken.mockResolvedValue({
      characterId: mainCharacter.characterId,
      characterName: mainCharacter.name,
      scopes: ['esi-characters.read_corporation_roles.v1'],
    })
    mocks.assertOrganizationOwnerDirectorRole.mockImplementationOnce(() => {
      throw new Error('not-director')
    })

    const response = await callbackRequest('valid-state', 'valid-state', 'code=eve-code', true)

    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/settings/integrations?organizationOwner=error',
    )
    expect(mocks.reauthorizeCharacter).toHaveBeenCalled()
    expect(mocks.claimOrganizationOwnership).not.toHaveBeenCalled()
  })

  test('reauthorizes only the state-bound character and preserves the active session', async () => {
    mocks.consumeOAuthState.mockResolvedValue({
      intent: 'reauthorize',
      userId,
      characterId: mainCharacter.characterId,
      returnPath: `/characters/${mainCharacter.characterId}/mail?reauthorize=stale&label=7`,
    })

    const response = await callbackRequest(
      'valid-state',
      'valid-state',
      'code=eve-code&returnTo=https%3A%2F%2Fexample.com',
      true,
    )

    expect(mocks.reauthorizeCharacter).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        expectedCharacterId: mainCharacter.characterId,
        characterId: mainCharacter.characterId,
      }),
    )
    expect(response.headers.get('set-cookie')).not.toContain('eve_space_session=')
    expect(response.headers.get('location')).toBe(
      `http://localhost:3000/characters/${mainCharacter.characterId}/mail?reauthorize=success&label=7`,
    )
    expect(new URL(response.headers.get('location')!).searchParams.getAll('reauthorize')).toEqual([
      'success',
    ])
  })

  test('uses the state-bound mailbox for cancellation and a missing code', async () => {
    mocks.consumeOAuthState.mockResolvedValue({
      intent: 'reauthorize',
      userId,
      characterId: mainCharacter.characterId,
      returnPath: `/characters/${mainCharacter.characterId}/mail?label=7`,
    })

    const cancelled = await callbackRequest(
      'valid-state',
      'valid-state',
      'error=access_denied',
      true,
    )
    const missingCode = await callbackRequest('valid-state', 'valid-state', '', true)

    expect(cancelled.headers.get('location')).toBe(
      `http://localhost:3000/characters/${mainCharacter.characterId}/mail?label=7&reauthorize=cancelled`,
    )
    expect(missingCode.headers.get('location')).toBe(
      `http://localhost:3000/characters/${mainCharacter.characterId}/mail?label=7&reauthorize=error`,
    )
    expect(mocks.exchangeAuthorizationCode).not.toHaveBeenCalled()
  })

  test('uses the state-bound mailbox when the callback session no longer matches', async () => {
    mocks.consumeOAuthState.mockResolvedValue({
      intent: 'reauthorize',
      userId,
      characterId: mainCharacter.characterId,
      returnPath: `/characters/${mainCharacter.characterId}/mail`,
    })
    mocks.findSession.mockResolvedValue({ ...account, userId: 'different-user' })

    const response = await callbackRequest('valid-state', 'valid-state', 'code=eve-code', true)

    expect(response.headers.get('location')).toBe(
      `http://localhost:3000/characters/${mainCharacter.characterId}/mail?reauthorize=error`,
    )
    expect(mocks.exchangeAuthorizationCode).not.toHaveBeenCalled()
  })

  test('uses the state-bound mailbox for upstream reauthorization failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    apiLogger.enableLogging()
    mocks.consumeOAuthState.mockResolvedValue({
      intent: 'reauthorize',
      userId,
      characterId: mainCharacter.characterId,
      returnPath: `/characters/${mainCharacter.characterId}/mail`,
    })
    mocks.exchangeAuthorizationCode.mockRejectedValue(new Error('secret upstream detail'))

    try {
      const response = await callbackRequest('valid-state', 'valid-state', 'code=eve-code', true)

      expect(response.headers.get('location')).toBe(
        `http://localhost:3000/characters/${mainCharacter.characterId}/mail?reauthorize=error`,
      )
      expect(response.headers.get('location')).not.toContain('secret')
      expect(consoleError).toHaveBeenCalledOnce()
      expect(String(consoleError.mock.calls[0]?.[0])).not.toContain('secret upstream detail')
    } finally {
      apiLogger.disableLogging()
      consoleError.mockRestore()
    }
  })

  test('falls back safely when a consumed state is replayed', async () => {
    mocks.consumeOAuthState
      .mockResolvedValueOnce({
        intent: 'reauthorize',
        userId,
        characterId: mainCharacter.characterId,
        returnPath: `/characters/${mainCharacter.characterId}/mail`,
      })
      .mockResolvedValueOnce(null)

    const first = await callbackRequest('valid-state', 'valid-state', 'error=access_denied', true)
    const replay = await callbackRequest('valid-state', 'valid-state', 'error=access_denied', true)

    expect(first.headers.get('location')).toBe(
      `http://localhost:3000/characters/${mainCharacter.characterId}/mail?reauthorize=cancelled`,
    )
    expect(replay.headers.get('location')).toBe('http://localhost:3000/auth?auth=error')
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
  test('exchanges a valid local fixture bearer through a form body for an HttpOnly cookie', async () => {
    const sessionToken = 'local-fixture-session-token-0000000000000000'
    const response = await app.request('/auth/local-fixture-session', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ sessionToken }),
    })

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://localhost:3000/')
    expect(response.headers.get('set-cookie')).toContain(`eve_space_session=${sessionToken}`)
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(mocks.findSession).toHaveBeenCalledWith(sessionToken)
  })

  test('refuses an invalid local fixture bearer', async () => {
    mocks.findSession.mockResolvedValueOnce(null)
    const response = await app.request('/auth/local-fixture-session', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        sessionToken: 'invalid-local-fixture-session-000000000000000',
      }),
    })

    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  test('does not expose the local fixture exchange outside development', async () => {
    const nodeEnvironment = env.NODE_ENV
    env.NODE_ENV = 'production'
    try {
      const response = await app.request('/auth/local-fixture-session', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          sessionToken: 'local-fixture-session-token-0000000000000000',
        }),
      })

      expect(response.status).toBe(404)
      expect(mocks.findSession).not.toHaveBeenCalled()
    } finally {
      env.NODE_ENV = nodeEnvironment
    }
  })

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

function callbackRequest(
  state: string,
  cookieState: string,
  query = '',
  session: boolean | string = false,
) {
  const suffix = query ? `&${query}` : ''
  const cookie = `eve_space_oauth_state=${cookieState}${
    session ? `; ${typeof session === 'string' ? session : 'eve_space_session=active-session'}` : ''
  }`
  return app.request(`/auth/eve/callback?state=${state}${suffix}`, {
    headers: { Cookie: cookie },
  })
}

function sessionHeader() {
  return { Cookie: 'eve_space_session=active-session' }
}

function reauthorizationRequest(returnTo: string) {
  const query = new URLSearchParams({ returnTo })
  return app.request(`/auth/eve/reauthorize/${mainCharacter.characterId}?${query}`, {
    headers: sessionHeader(),
  })
}

function transferStartRequest(options: { origin?: string; session?: boolean } = {}) {
  return app.request('/auth/eve/transfer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: options.origin ?? 'http://localhost:3000',
      ...(options.session === false ? {} : sessionHeader()),
    },
    body: JSON.stringify({
      approvalId: transferApprovalId,
      secret: 'transfer-link-secret-value-that-is-long-enough',
    }),
  })
}

function transferState(characterId = 2_112_625_428) {
  return {
    intent: 'transfer' as const,
    approvalId: transferApprovalId,
    sourceUserId: transferSourceUserId,
    sourceSubjectLifecycleId: transferSourceSubjectLifecycleId,
    userId,
    characterId,
  }
}

function cookiePair(response: Response, name: string) {
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${name}=`))
    ?.split(';', 1)[0]
  if (!cookie) throw new Error(`Response did not issue ${name}`)
  return cookie
}
