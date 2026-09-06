import { testClient } from 'hono/testing'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class ScopeRequiredError extends Error {
    constructor(readonly scope: string) {
      super(`Missing ${scope}`)
    }
  }
  class TokenRefreshUnavailableError extends Error {}
  class CharacterAssetsPaginationError extends Error {}
  return {
    CharacterAssetsPaginationError,
    ScopeRequiredError,
    TokenRefreshUnavailableError,
    findOwnedCharacter: vi.fn(),
    findSession: vi.fn(),
    getCharacterAssets: vi.fn(),
  }
})

vi.mock('../../src/auth/store.js', () => ({
  CharacterTokenNotFoundError: class CharacterTokenNotFoundError extends Error {},
  deleteCharacter: vi.fn(),
  findOwnedCharacter: mocks.findOwnedCharacter,
  findSession: mocks.findSession,
  listUserCharacters: vi.fn(),
  setMainCharacter: vi.fn(),
}))
vi.mock('../../src/env.js', () => ({
  env: {
    EVE_CALLBACK_URL: 'http://localhost:8788/auth/eve/callback',
    WEB_ORIGIN: 'http://localhost:3000',
  },
}))
vi.mock('../../src/auth/tokens.js', () => ({
  ScopeRequiredError: mocks.ScopeRequiredError,
  TokenRefreshUnavailableError: mocks.TokenRefreshUnavailableError,
}))
vi.mock('../../src/characters/assets.js', () => ({
  characterAssetsScope: 'esi-assets.read_assets.v1',
  CharacterAssetsPaginationError: mocks.CharacterAssetsPaginationError,
  getCharacterAssets: mocks.getCharacterAssets,
}))
vi.mock('../../src/characters/profile.js', () => ({ getCharacterProfile: vi.fn() }))
vi.mock('../../src/characters/overview.js', () => ({
  getCharacterLocation: vi.fn(),
  getCharacterShip: vi.fn(),
  getCharacterSkillsSummary: vi.fn(),
  locationScope: 'esi-location.read_location.v1',
  shipScope: 'esi-location.read_ship_type.v1',
  skillsScope: 'esi-skills.read_skills.v1',
}))

import { ScopeRequiredError, TokenRefreshUnavailableError } from '../../src/auth/tokens.js'
import { CharacterAssetsPaginationError } from '../../src/characters/assets.js'
import { characterRoutes } from '../../src/characters/routes.js'
import { EsiQuotaError } from '../../src/esi-resilience/cooldowns.js'

const client = testClient(characterRoutes)
const characterId = 1404328063
const sessionHeaders = { Cookie: 'eve_space_session=active-session' }
const character = {
  characterId,
  name: 'Asset Pilot',
  corporationId: 1000166,
  allianceId: null,
  isMain: true,
  subjectLifecycleId: 'de1e1285-0d02-4dd0-9ca4-c3b7a28e0011',
}
const session = {
  userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
  mainCharacter: character,
}
const assets = {
  characterId,
  assets: [
    {
      itemId: 22,
      typeId: 34,
      typeName: 'Tritanium',
      groupId: 18,
      groupName: 'Mineral',
      categoryId: 4,
      categoryName: 'Material',
      unitVolume: 0.01,
      totalVolume: 0.05,
      quantity: 5,
      isSingleton: true,
      isBlueprintCopy: null,
      customName: null,
      locationId: 60_000_001,
      locationType: 'station',
      locationName: 'Jita IV - Moon 4',
      locationFlag: 'Hangar',
      parentItemId: null,
    },
  ],
  enrichment: { types: 'complete', names: 'partial', locations: 'unavailable' },
  cachedUntil: '2026-09-03T12:00:00.000Z',
  validatedAt: '2026-09-03T11:00:00.000Z',
  stale: true,
  refreshFailureClass: 'esi-unavailable',
}

beforeEach(() => {
  mocks.findOwnedCharacter.mockReset()
  mocks.findSession.mockReset()
  mocks.getCharacterAssets.mockReset()
  mocks.findOwnedCharacter.mockResolvedValue(character)
  mocks.findSession.mockResolvedValue(session)
  mocks.getCharacterAssets.mockResolvedValue(assets)
})

describe('typed character asset route', () => {
  test('returns the complete DTO and independent enrichment/freshness state privately', async () => {
    const response = await client[':characterId'].assets.$get(
      { param: { characterId: String(characterId) } },
      { headers: sessionHeaders },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(assets)
    expect(mocks.getCharacterAssets).toHaveBeenCalledWith(characterId)
    expectPrivateHeaders(response)
  })

  test('requires a session before ownership or service access', async () => {
    const response = await characterRoutes.request(`/${characterId}/assets`)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      code: 'AUTH_REQUIRED',
      message: 'Log in with EVE Online first.',
    })
    expect(mocks.findSession).not.toHaveBeenCalled()
    expect(mocks.findOwnedCharacter).not.toHaveBeenCalled()
    expect(mocks.getCharacterAssets).not.toHaveBeenCalled()
    expectPrivateHeaders(response)
  })

  test.each(['invalid', '0', '01', String(Number.MAX_SAFE_INTEGER + 1)])(
    'rejects malformed character ID %s before session or ownership',
    async (invalidId) => {
      const response = await authorizedRequest(`/${invalidId}/assets`)

      expect(response.status).toBe(400)
      expect(mocks.findSession).not.toHaveBeenCalled()
      expect(mocks.findOwnedCharacter).not.toHaveBeenCalled()
      expect(mocks.getCharacterAssets).not.toHaveBeenCalled()
      expectPrivateHeaders(response)
    },
  )

  test.each(['unknown', 'non-owned'])('hides whether an %s character exists', async () => {
    mocks.findOwnedCharacter.mockResolvedValueOnce(null)

    const response = await authorizedRequest('/90000001/assets')

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      code: 'CHARACTER_NOT_FOUND',
      message: 'Character not found.',
    })
    expect(mocks.getCharacterAssets).not.toHaveBeenCalled()
    expectPrivateHeaders(response)
  })

  test('maps missing scope to exact-character Assets reauthorization', async () => {
    mocks.getCharacterAssets.mockRejectedValue(new ScopeRequiredError('esi-untrusted.scope.v1'))

    const response = await authorizedRequest(`/${characterId}/assets`)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      code: 'EVE_SCOPE_REQUIRED',
      message: 'Authorize asset access for this character.',
      requiredScope: 'esi-assets.read_assets.v1',
      authorizeUrl: reauthorizationUrl(),
    })
    expectPrivateHeaders(response)
  })

  test.each([401, 403])(
    'maps rejected authorization status %s to reauthorization',
    async (status) => {
      mocks.getCharacterAssets.mockRejectedValue(
        Object.assign(new Error('sensitive upstream body'), { status }),
      )

      const response = await authorizedRequest(`/${characterId}/assets`)

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({
        code: 'EVE_REAUTH_REQUIRED',
        message: 'EVE authorization is no longer valid.',
        requiredScope: 'esi-assets.read_assets.v1',
        authorizeUrl: reauthorizationUrl(),
      })
      expectPrivateHeaders(response)
    },
  )

  test('maps cooldown with Retry-After', async () => {
    mocks.getCharacterAssets.mockRejectedValue(new EsiQuotaError(17))

    const response = await authorizedRequest(`/${characterId}/assets`)

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('17')
    await expect(response.json()).resolves.toEqual({
      code: 'ESI_COOLDOWN',
      message: 'EVE Online ESI is temporarily rate limited.',
      retryAfterSeconds: 17,
    })
    expectPrivateHeaders(response)
  })

  test('maps token refresh contention without leaking details', async () => {
    mocks.getCharacterAssets.mockRejectedValue(new TokenRefreshUnavailableError())

    const response = await authorizedRequest(`/${characterId}/assets`)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      code: 'EVE_TOKEN_REFRESH_UNAVAILABLE',
      message: 'EVE token refresh is temporarily unavailable. Try again shortly.',
    })
    expectPrivateHeaders(response)
  })

  test('maps invalid pagination separately from unavailable complete collections', async () => {
    mocks.getCharacterAssets.mockRejectedValueOnce(new CharacterAssetsPaginationError())
    const invalid = await authorizedRequest(`/${characterId}/assets`)
    expect(invalid.status).toBe(502)
    await expect(invalid.json()).resolves.toEqual({
      code: 'ESI_RESPONSE_INVALID',
      message: 'EVE Online returned invalid asset pagination metadata.',
    })

    mocks.getCharacterAssets.mockRejectedValueOnce(new Error('required page unavailable'))
    const unavailable = await authorizedRequest(`/${characterId}/assets`)
    expect(unavailable.status).toBe(502)
    await expect(unavailable.json()).resolves.toEqual({
      code: 'ESI_UNAVAILABLE',
      message: 'Unable to retrieve the complete character asset collection.',
    })
    expectPrivateHeaders(invalid)
    expectPrivateHeaders(unavailable)
  })
})

function authorizedRequest(path: string) {
  return characterRoutes.request(path, { headers: sessionHeaders })
}

function reauthorizationUrl() {
  return `http://localhost:8788/auth/eve/reauthorize/${characterId}?returnTo=%2Fcharacters%2F${characterId}%2Fassets`
}

function expectPrivateHeaders(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('vary')).toBe('Cookie')
}
