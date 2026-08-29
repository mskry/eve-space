import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findOwnedCharacter: vi.fn(),
  findSession: vi.fn(),
  getCharacterAttributes: vi.fn(),
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
vi.mock('../../src/characters/attributes.js', () => ({
  characterAttributesScope: 'esi-skills.read_skills.v1',
  getCharacterAttributes: mocks.getCharacterAttributes,
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
const attributes = {
  charisma: 19,
  intelligence: 27,
  memory: 23,
  perception: 24,
  willpower: 21,
  bonusRemaps: 2,
  accruedRemapCooldownDate: '2026-10-01T12:00:00Z',
  lastRemapDate: '2025-10-01T12:00:00Z',
}

beforeEach(() => {
  mocks.findSession.mockResolvedValue(session)
  mocks.findOwnedCharacter.mockResolvedValue(character)
  mocks.getCharacterAttributes.mockResolvedValue(attributes)
})

describe('character attributes route', () => {
  test('returns attributes with private non-storeable headers', async () => {
    const response = await authorizedRequest(`/${character.characterId}/attributes`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(attributes)
    expect(mocks.getCharacterAttributes).toHaveBeenCalledWith(character.characterId)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toBe('Cookie')
  })

  test('validates malformed IDs before session and ownership access', async () => {
    const response = await authorizedRequest('/invalid/attributes')

    expect(response.status).toBe(400)
    expect(mocks.findSession).not.toHaveBeenCalled()
    expect(mocks.findOwnedCharacter).not.toHaveBeenCalled()
    expect(mocks.getCharacterAttributes).not.toHaveBeenCalled()
  })

  test('rejects non-owned characters before protected service access', async () => {
    mocks.findOwnedCharacter.mockResolvedValue(null)

    const response = await authorizedRequest('/90000001/attributes')

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      code: 'CHARACTER_NOT_FOUND',
      message: 'Character not found.',
    })
    expect(mocks.getCharacterAttributes).not.toHaveBeenCalled()
  })

  test('returns character-bound scope requirements without token material', async () => {
    mocks.getCharacterAttributes.mockRejectedValue(
      new ScopeRequiredError('esi-skills.read_skills.v1'),
    )

    const response = await authorizedRequest(`/${character.characterId}/attributes`)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toEqual({
      code: 'EVE_SCOPE_REQUIRED',
      message: 'Authorize attributes access for this character.',
      requiredScope: 'esi-skills.read_skills.v1',
      authorizeUrl: `http://localhost:8788/auth/eve/reauthorize/${character.characterId}`,
    })
    expect(JSON.stringify(body)).not.toMatch(/access.token|refresh.token|encrypted/i)
  })

  test('maps rejected ESI authorization to exact-character reauthorization', async () => {
    mocks.getCharacterAttributes.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { status: 403 }),
    )

    const response = await authorizedRequest(`/${character.characterId}/attributes`)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      code: 'EVE_REAUTH_REQUIRED',
      message: 'EVE authorization is no longer valid.',
      requiredScope: 'esi-skills.read_skills.v1',
      authorizeUrl: `http://localhost:8788/auth/eve/reauthorize/${character.characterId}`,
    })
  })

  test('maps unexpected failures to a safe temporary response', async () => {
    mocks.getCharacterAttributes.mockRejectedValue(new Error('upstream body with secret detail'))

    const response = await authorizedRequest(`/${character.characterId}/attributes`)

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      code: 'ESI_UNAVAILABLE',
      message: 'EVE Online ESI is temporarily unavailable.',
    })
  })

  test('maps quota deferrals to a retryable response', async () => {
    mocks.getCharacterAttributes.mockRejectedValue(new EsiQuotaError(12))

    const response = await authorizedRequest(`/${character.characterId}/attributes`)

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('12')
    await expect(response.json()).resolves.toEqual({
      code: 'ESI_COOLDOWN',
      message: 'EVE Online ESI is temporarily rate limited.',
      retryAfterSeconds: 12,
    })
  })

  test('maps token refresh contention to a controlled response', async () => {
    mocks.getCharacterAttributes.mockRejectedValue(new TokenRefreshUnavailableError())

    const response = await authorizedRequest(`/${character.characterId}/attributes`)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      code: 'EVE_TOKEN_REFRESH_UNAVAILABLE',
      message: 'EVE token refresh is temporarily unavailable. Try again shortly.',
    })
  })
})

function authorizedRequest(path: string) {
  return characterRoutes.request(path, {
    headers: { Cookie: 'eve_space_session=active-session' },
  })
}
