import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findOwnedCharacter: vi.fn(),
  findSession: vi.fn(),
  getCharacterSkillQueue: vi.fn(),
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
vi.mock('../../src/characters/skill-queue.js', () => ({
  characterSkillQueueScope: 'esi-skills.read_skillqueue.v1',
  getCharacterSkillQueue: mocks.getCharacterSkillQueue,
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
const queue = { entries: [] }

beforeEach(() => {
  mocks.findSession.mockResolvedValue(session)
  mocks.findOwnedCharacter.mockResolvedValue(character)
  mocks.getCharacterSkillQueue.mockResolvedValue(queue)
})

describe('character skill queue route', () => {
  test('returns the queue with private non-storeable headers', async () => {
    const response = await authorizedRequest(`/${character.characterId}/skill-queue`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(queue)
    expect(mocks.getCharacterSkillQueue).toHaveBeenCalledWith(character.characterId)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toBe('Cookie')
  })

  test('validates ownership before accessing the queue', async () => {
    mocks.findOwnedCharacter.mockResolvedValue(null)

    const response = await authorizedRequest('/90000001/skill-queue')

    expect(response.status).toBe(404)
    expect(mocks.getCharacterSkillQueue).not.toHaveBeenCalled()
  })

  test('returns the queue-specific authorization requirement', async () => {
    mocks.getCharacterSkillQueue.mockRejectedValue(
      new ScopeRequiredError('esi-skills.read_skillqueue.v1'),
    )

    const response = await authorizedRequest(`/${character.characterId}/skill-queue`)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      code: 'EVE_SCOPE_REQUIRED',
      message: 'Authorize skill queue access for this character.',
      requiredScope: 'esi-skills.read_skillqueue.v1',
      authorizeUrl: `http://localhost:8788/auth/eve/reauthorize/${character.characterId}`,
    })
  })

  test.each([
    [new EsiQuotaError(12), 429],
    [new TokenRefreshUnavailableError(), 503],
    [Object.assign(new Error('Forbidden'), { status: 403 }), 403],
    [new Error('upstream detail'), 502],
  ])('maps service failure %# to a controlled response', async (error, status) => {
    mocks.getCharacterSkillQueue.mockRejectedValue(error)

    const response = await authorizedRequest(`/${character.characterId}/skill-queue`)

    expect(response.status).toBe(status)
  })
})

function authorizedRequest(path: string) {
  return characterRoutes.request(path, {
    headers: { Cookie: 'eve_space_session=active-session' },
  })
}
