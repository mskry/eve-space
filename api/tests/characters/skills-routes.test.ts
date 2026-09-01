import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findOwnedCharacter: vi.fn(),
  findSession: vi.fn(),
  getCharacterSkills: vi.fn(),
}))

vi.mock('../../src/auth/store.js', () => ({
  CharacterTokenNotFoundError: class CharacterTokenNotFoundError extends Error {},
  deleteCharacter: vi.fn(),
  findOwnedCharacter: mocks.findOwnedCharacter,
  findSession: mocks.findSession,
  listUserCharacters: vi.fn(),
  setMainCharacter: vi.fn(),
}))

vi.mock('../../src/env.js', () => ({
  env: { EVE_CALLBACK_URL: 'http://localhost:8788/auth/eve/callback' },
}))

vi.mock('../../src/auth/tokens.js', () => ({
  ScopeRequiredError: class ScopeRequiredError extends Error {
    constructor(readonly scope: string) {
      super(`Missing ${scope}`)
    }
  },
  TokenRefreshUnavailableError: class TokenRefreshUnavailableError extends Error {},
}))

vi.mock('../../src/characters/skills.js', () => ({
  characterSkillsScope: 'esi-skills.read_skills.v1',
  getCharacterSkills: mocks.getCharacterSkills,
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

import { characterRoutes } from '../../src/characters/routes.js'
import { EsiQuotaError } from '../../src/esi-resilience/cooldowns.js'
import { ScopeRequiredError, TokenRefreshUnavailableError } from '../../src/auth/tokens.js'

const character = {
  characterId: 1404328063,
  name: 'Bandera Primary',
  corporationId: 1000166,
  allianceId: null,
  isMain: true,
}
const session = {
  userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
  mainCharacter: character,
}
const skills = {
  totalSp: 1000,
  unallocatedSp: 0,
  injectedSkillCount: 1,
  groups: [
    {
      groupId: 10,
      name: 'Spaceship Command',
      trainedSp: 1000,
      skills: [
        {
          typeId: 3300,
          name: 'Gunnery',
          injected: true,
          activeLevel: 3,
          trainedLevel: 4,
          skillpoints: 1000,
        },
      ],
    },
  ],
}

beforeEach(() => {
  mocks.findSession.mockResolvedValue(session)
  mocks.findOwnedCharacter.mockResolvedValue(character)
  mocks.getCharacterSkills.mockResolvedValue(skills)
})

describe('character skills route', () => {
  test('returns grouped skills with private non-storeable headers', async () => {
    const response = await authorizedRequest(`/${character.characterId}/skills`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(skills)
    expect(mocks.getCharacterSkills).toHaveBeenCalledWith(character.characterId)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toBe('Cookie')
  })

  test('requires an application session before ownership or skills access', async () => {
    const response = await characterRoutes.request(`/${character.characterId}/skills`)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      code: 'AUTH_REQUIRED',
      message: 'Log in with EVE Online first.',
    })
    expect(mocks.findSession).not.toHaveBeenCalled()
    expect(mocks.findOwnedCharacter).not.toHaveBeenCalled()
    expect(mocks.getCharacterSkills).not.toHaveBeenCalled()
    expectPrivateHeaders(response)
  })

  test('validates malformed IDs before session and ownership access', async () => {
    const response = await authorizedRequest('/invalid/skills')

    expect(response.status).toBe(400)
    expect(mocks.findSession).not.toHaveBeenCalled()
    expect(mocks.findOwnedCharacter).not.toHaveBeenCalled()
    expect(mocks.getCharacterSkills).not.toHaveBeenCalled()
    expectPrivateHeaders(response)
  })

  test('returns the same 404 for non-owned characters before protected service access', async () => {
    mocks.findOwnedCharacter.mockResolvedValue(null)

    const response = await authorizedRequest('/90000001/skills')

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      code: 'CHARACTER_NOT_FOUND',
      message: 'Character not found.',
    })
    expect(mocks.getCharacterSkills).not.toHaveBeenCalled()
    expectPrivateHeaders(response)
  })

  test('returns a character-bound scope-required response without token material', async () => {
    mocks.getCharacterSkills.mockRejectedValue(new ScopeRequiredError('esi-skills.read_skills.v1'))

    const response = await authorizedRequest(`/${character.characterId}/skills`)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({
      code: 'EVE_SCOPE_REQUIRED',
      message: 'Authorize skills access for this character.',
      requiredScope: 'esi-skills.read_skills.v1',
      authorizeUrl: `http://localhost:8788/auth/eve/reauthorize/${character.characterId}`,
    })
    expect(JSON.stringify(body)).not.toMatch(/access.token|refresh.token|encrypted/i)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toBe('Cookie')
  })

  test('maps rejected ESI authorization to reauthorization for the exact character', async () => {
    mocks.getCharacterSkills.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { status: 401 }),
    )

    const response = await authorizedRequest(`/${character.characterId}/skills`)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      code: 'EVE_REAUTH_REQUIRED',
      message: 'EVE authorization is no longer valid.',
      requiredScope: 'esi-skills.read_skills.v1',
      authorizeUrl: `http://localhost:8788/auth/eve/reauthorize/${character.characterId}`,
    })
    expectPrivateHeaders(response)
  })

  test('maps unexpected ESI failures to a safe temporary failure', async () => {
    mocks.getCharacterSkills.mockRejectedValue(new Error('upstream body with secret detail'))

    const response = await authorizedRequest(`/${character.characterId}/skills`)

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      code: 'ESI_UNAVAILABLE',
      message: 'EVE Online ESI is temporarily unavailable.',
    })
    expectPrivateHeaders(response)
  })

  test('maps ESI concurrency and cooldown deferrals to a retryable response', async () => {
    mocks.getCharacterSkills.mockRejectedValue(new EsiQuotaError(12))

    const response = await authorizedRequest(`/${character.characterId}/skills`)

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('12')
    await expect(response.json()).resolves.toEqual({
      code: 'ESI_COOLDOWN',
      message: 'EVE Online ESI is temporarily rate limited.',
      retryAfterSeconds: 12,
    })
    expectPrivateHeaders(response)
  })

  test('maps token refresh contention to a controlled unavailable response', async () => {
    mocks.getCharacterSkills.mockRejectedValue(new TokenRefreshUnavailableError())

    const response = await authorizedRequest(`/${character.characterId}/skills`)

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      code: 'EVE_TOKEN_REFRESH_UNAVAILABLE',
      message: 'EVE token refresh is temporarily unavailable. Try again shortly.',
    })
    expectPrivateHeaders(response)
  })
})

function authorizedRequest(path: string) {
  return characterRoutes.request(path, {
    headers: { Cookie: 'eve_space_session=active-session' },
  })
}

function expectPrivateHeaders(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('vary')).toBe('Cookie')
}
