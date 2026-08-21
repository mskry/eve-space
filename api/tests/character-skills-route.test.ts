import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findOwnedCharacter: vi.fn(),
  findSession: vi.fn(),
  getCharacterSkills: vi.fn(),
}))

vi.mock('../src/auth-store.js', () => ({
  deleteCharacter: vi.fn(),
  findOwnedCharacter: mocks.findOwnedCharacter,
  findSession: mocks.findSession,
  listUserCharacters: vi.fn(),
  setMainCharacter: vi.fn(),
}))

vi.mock('../src/env.js', () => ({
  env: { EVE_CALLBACK_URL: 'http://localhost:8788/auth/eve/callback' },
}))

vi.mock('../src/token-service.js', () => ({
  ScopeRequiredError: class ScopeRequiredError extends Error {
    constructor(readonly scope: string) {
      super(`Missing ${scope}`)
    }
  },
}))

vi.mock('../src/character-skills-service.js', () => ({
  characterSkillsScope: 'esi-skills.read_skills.v1',
  getCharacterSkills: mocks.getCharacterSkills,
}))

vi.mock('../src/character-profile.js', () => ({ getCharacterProfile: vi.fn() }))
vi.mock('../src/character-overview-service.js', () => ({
  getCharacterLocation: vi.fn(),
  getCharacterShip: vi.fn(),
  getCharacterSkillsSummary: vi.fn(),
  locationScope: 'esi-location.read_location.v1',
  shipScope: 'esi-location.read_ship_type.v1',
  skillsScope: 'esi-skills.read_skills.v1',
}))

import { characterRoutes } from '../src/routes/characters.js'
import { ScopeRequiredError } from '../src/token-service.js'

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
  groups: [
    {
      groupId: 10,
      name: 'Spaceship Command',
      trainedSp: 1000,
      skills: [
        {
          typeId: 3300,
          name: 'Gunnery',
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

  test('validates malformed IDs before session and ownership access', async () => {
    const response = await authorizedRequest('/invalid/skills')

    expect(response.status).toBe(400)
    expect(mocks.findSession).not.toHaveBeenCalled()
    expect(mocks.findOwnedCharacter).not.toHaveBeenCalled()
    expect(mocks.getCharacterSkills).not.toHaveBeenCalled()
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
  })

  test('maps unexpected ESI failures to a safe temporary failure', async () => {
    mocks.getCharacterSkills.mockRejectedValue(new Error('upstream body with secret detail'))

    const response = await authorizedRequest(`/${character.characterId}/skills`)

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      code: 'ESI_UNAVAILABLE',
      message: 'EVE Online ESI is temporarily unavailable.',
    })
  })
})

function authorizedRequest(path: string) {
  return characterRoutes.request(path, {
    headers: { Cookie: 'eve_space_session=active-session' },
  })
}
