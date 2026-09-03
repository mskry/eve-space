import { testClient } from 'hono/testing'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class ScopeRequiredError extends Error {
    constructor(readonly scope: string) {
      super(`Missing ${scope}`)
    }
  }
  class TokenRefreshUnavailableError extends Error {}
  return {
    ScopeRequiredError,
    TokenRefreshUnavailableError,
    findOwnedCharacter: vi.fn(),
    findSession: vi.fn(),
    getCharacterClones: vi.fn(),
    getCharacterImplants: vi.fn(),
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
vi.mock('../../src/characters/clones.js', () => ({
  characterClonesScope: 'esi-clones.read_clones.v1',
  characterImplantsScope: 'esi-clones.read_implants.v1',
  getCharacterClones: mocks.getCharacterClones,
  getCharacterImplants: mocks.getCharacterImplants,
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
import { characterRoutes } from '../../src/characters/routes.js'
import { EsiQuotaError } from '../../src/esi-resilience/cooldowns.js'

const client = testClient(characterRoutes)
const characterId = 1404328063
const sessionHeaders = { Cookie: 'eve_space_session=active-session' }
const character = {
  characterId,
  name: 'Clone Pilot',
  corporationId: 1000166,
  allianceId: null,
  isMain: true,
  subjectLifecycleId: 'de1e1285-0d02-4dd0-9ca4-c3b7a28e0011',
}
const session = {
  userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
  mainCharacter: character,
}
const freshness = {
  cachedUntil: '2026-09-03T11:02:00.000Z',
  validatedAt: '2026-09-03T11:00:00.000Z',
  stale: false,
}
const clones = {
  homeLocation: { locationId: 60_000_001, locationType: 'station', name: 'Jita IV - Moon 4' },
  jumpClones: [
    {
      jumpCloneId: 11,
      name: 'Industry',
      location: { locationId: 1_035_466_617_946, locationType: 'structure', name: null },
      implants: [{ typeId: 2, name: 'Memory Augmentation' }],
    },
  ],
  lastCloneJumpAt: '2026-09-02T12:00:00Z',
  lastStationChangeAt: null,
  ...freshness,
}
const implants = {
  implants: [{ typeId: 3, name: 'Ocular Filter' }],
  ...freshness,
}

beforeEach(() => {
  mocks.findSession.mockReset()
  mocks.findOwnedCharacter.mockReset()
  mocks.getCharacterClones.mockReset()
  mocks.getCharacterImplants.mockReset()
  mocks.findSession.mockResolvedValue(session)
  mocks.findOwnedCharacter.mockResolvedValue(character)
  mocks.getCharacterClones.mockResolvedValue(clones)
  mocks.getCharacterImplants.mockResolvedValue(implants)
})

describe('typed character clone routes', () => {
  test('returns independent clone and implant DTOs with private headers', async () => {
    const cloneResponse = await client[':characterId'].clones.$get(
      { param: { characterId: String(characterId) } },
      { headers: sessionHeaders },
    )
    const implantResponse = await client[':characterId'].implants.$get(
      { param: { characterId: String(characterId) } },
      { headers: sessionHeaders },
    )

    expect(cloneResponse.status).toBe(200)
    await expect(cloneResponse.json()).resolves.toEqual(clones)
    expectPrivateHeaders(cloneResponse)
    expect(implantResponse.status).toBe(200)
    await expect(implantResponse.json()).resolves.toEqual(implants)
    expectPrivateHeaders(implantResponse)
    expect(mocks.getCharacterClones).toHaveBeenCalledWith(characterId)
    expect(mocks.getCharacterImplants).toHaveBeenCalledWith(characterId)
  })

  test.each(['clones', 'implants'] as const)(
    'requires a session before ownership or %s service access',
    async (resource) => {
      const response = await characterRoutes.request(`/${characterId}/${resource}`)

      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toEqual({
        code: 'AUTH_REQUIRED',
        message: 'Log in with EVE Online first.',
      })
      expect(mocks.findSession).not.toHaveBeenCalled()
      expectServicesUntouched()
      expectPrivateHeaders(response)
    },
  )

  test.each(['invalid', '0', '01'])(
    'rejects malformed character ID %s before session or ownership access',
    async (invalidId) => {
      const response = await authorizedRequest(`/${invalidId}/clones`)

      expect(response.status).toBe(400)
      expect(mocks.findSession).not.toHaveBeenCalled()
      expect(mocks.findOwnedCharacter).not.toHaveBeenCalled()
      expectServicesUntouched()
      expectPrivateHeaders(response)
    },
  )

  test.each(['unknown', 'non-owned'])(
    'returns the indistinguishable not-found response for an %s character',
    async () => {
      mocks.findOwnedCharacter.mockResolvedValueOnce(null)

      const response = await authorizedRequest('/90000001/clones')

      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toEqual({
        code: 'CHARACTER_NOT_FOUND',
        message: 'Character not found.',
      })
      expectServicesUntouched()
      expectPrivateHeaders(response)
    },
  )
})

const resourceCases = [
  {
    path: 'clones',
    scope: 'esi-clones.read_clones.v1',
    scopeMessage: 'Authorize clone access for this character.',
    unavailableMessage: 'Unable to retrieve character clone state.',
    service: mocks.getCharacterClones,
  },
  {
    path: 'implants',
    scope: 'esi-clones.read_implants.v1',
    scopeMessage: 'Authorize implant access for this character.',
    unavailableMessage: 'Unable to retrieve active implants.',
    service: mocks.getCharacterImplants,
  },
] as const

describe.each(resourceCases)('character $path route failures', (resource) => {
  test('publishes its registered scope and exact-character return target', async () => {
    resource.service.mockRejectedValue(new ScopeRequiredError('esi-wrong.scope.v1'))

    const response = await authorizedRequest(`/${characterId}/${resource.path}`)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      code: 'EVE_SCOPE_REQUIRED',
      message: resource.scopeMessage,
      requiredScope: resource.scope,
      authorizeUrl: reauthorizationUrl(),
    })
    expectPrivateHeaders(response)
  })

  test.each([401, 403])(
    'maps upstream status %s to exact-character reauthorization',
    async (status) => {
      resource.service.mockRejectedValue(
        Object.assign(new Error('sensitive upstream body'), { status }),
      )

      const response = await authorizedRequest(`/${characterId}/${resource.path}`)

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({
        code: 'EVE_REAUTH_REQUIRED',
        message: 'EVE authorization is no longer valid.',
        requiredScope: resource.scope,
        authorizeUrl: reauthorizationUrl(),
      })
      expectPrivateHeaders(response)
    },
  )

  test('maps cooldown to a retryable response', async () => {
    resource.service.mockRejectedValue(new EsiQuotaError(12))

    const response = await authorizedRequest(`/${characterId}/${resource.path}`)

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('12')
    await expect(response.json()).resolves.toEqual({
      code: 'ESI_COOLDOWN',
      message: 'EVE Online ESI is temporarily rate limited.',
      retryAfterSeconds: 12,
    })
    expectPrivateHeaders(response)
  })

  test('maps token refresh contention without leaking details', async () => {
    resource.service.mockRejectedValue(new TokenRefreshUnavailableError())

    const response = await authorizedRequest(`/${characterId}/${resource.path}`)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      code: 'EVE_TOKEN_REFRESH_UNAVAILABLE',
      message: 'EVE token refresh is temporarily unavailable. Try again shortly.',
    })
    expectPrivateHeaders(response)
  })

  test('maps unexpected upstream failures to a safe resource-specific response', async () => {
    resource.service.mockRejectedValue(new Error('sensitive upstream body'))

    const response = await authorizedRequest(`/${characterId}/${resource.path}`)

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      code: 'ESI_UNAVAILABLE',
      message: resource.unavailableMessage,
    })
    expectPrivateHeaders(response)
  })
})

test('does not mount or request character jump fatigue', async () => {
  const response = await authorizedRequest(`/${characterId}/fatigue`)

  expect(response.status).toBe(404)
  expectServicesUntouched()
})

function authorizedRequest(path: string) {
  return characterRoutes.request(path, { headers: sessionHeaders })
}

function reauthorizationUrl() {
  return `http://localhost:8788/auth/eve/reauthorize/${characterId}?returnTo=%2Fcharacters%2F${characterId}%2Fclones`
}

function expectServicesUntouched() {
  expect(mocks.getCharacterClones).not.toHaveBeenCalled()
  expect(mocks.getCharacterImplants).not.toHaveBeenCalled()
}

function expectPrivateHeaders(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('vary')).toBe('Cookie')
}
