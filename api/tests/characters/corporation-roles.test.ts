import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createCharacterClient: vi.fn(),
  createEsiTransport: vi.fn(),
  get: vi.fn(),
  getCorporationRoles: vi.fn(),
}))

vi.mock('@evespace/esi-client/domains/character', () => ({
  createCharacterClient: mocks.createCharacterClient,
}))
vi.mock('../../src/esi-resilience/resilience.js', () => ({
  getEsiResilienceLayer: () => ({ getCharacter: mocks.get }),
}))
vi.mock('../../src/esi-resilience/transport.js', () => ({
  createEsiTransport: mocks.createEsiTransport,
}))

const characterId = 1_404_328_063
const revalidation = { ifNoneMatch: 'roles-etag', ifModifiedSince: 'roles-date' }

beforeEach(() => {
  mocks.get.mockImplementation(async (resource) => {
    const loaded = await resource.load(
      { accessToken: 'access-token', principal: `character-${characterId}` },
      revalidation,
    )
    return { data: loaded.data, cachedUntil: '', quota: {}, source: 'esi', stale: false }
  })
  mocks.createCharacterClient.mockReturnValue({
    withMetadata: () => ({ getCorporationRoles: mocks.getCorporationRoles }),
  })
})

describe('character corporation roles', () => {
  test('loads and maps current roles through the registered private resource', async () => {
    mocks.getCorporationRoles.mockResolvedValue(
      response({
        roles: ['Director', 'Accountant'],
        roles_at_base: ['Factory_Manager'],
        roles_at_hq: ['Station_Manager'],
        roles_at_other: ['Starbase_Defense_Operator'],
      }),
    )
    const { characterCorporationRolesScope, getCharacterCorporationRoles } =
      await import('../../src/characters/corporation-roles.js')

    await expect(getCharacterCorporationRoles(characterId)).resolves.toEqual({
      roles: ['Director', 'Accountant'],
      rolesAtBase: ['Factory_Manager'],
      rolesAtHeadquarters: ['Station_Manager'],
      rolesAtOther: ['Starbase_Defense_Operator'],
    })
    expect(characterCorporationRolesScope).toBe('esi-characters.read_corporation_roles.v1')
    expect(mocks.get.mock.calls[0]?.[0]).toMatchObject({
      operation: 'character-corporation-roles',
      inputs: { characterId },
    })
    expect(mocks.createEsiTransport).toHaveBeenCalledWith(
      'character-corporation-roles',
      `character-${characterId}`,
    )
    expect(mocks.getCorporationRoles).toHaveBeenCalledWith(characterId, revalidation)
  })

  test('normalizes absent role categories', async () => {
    mocks.getCorporationRoles.mockResolvedValue(response({}))
    const { getCharacterCorporationRoles } =
      await import('../../src/characters/corporation-roles.js')

    await expect(getCharacterCorporationRoles(characterId)).resolves.toEqual({
      roles: [],
      rolesAtBase: [],
      rolesAtHeadquarters: [],
      rolesAtOther: [],
    })
  })
})

function response<Data>(data: Data) {
  return { data, meta: { headers: {} } }
}
