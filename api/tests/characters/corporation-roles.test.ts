import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeCharacterRepresentation: vi.fn(),
  getCorporationRoles: vi.fn(),
}))

vi.mock('@evespace/esi-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@evespace/esi-client')>()),
  EsiClient: class {
    callOperation(...arguments_: unknown[]) {
      return mocks.getCorporationRoles(...arguments_)
    }
  },
}))
vi.mock('../../src/esi-resilience/layer.js', () => ({
  getEsiResilienceLayer: () => ({
    executeCharacterRepresentation: mocks.executeCharacterRepresentation,
  }),
}))
vi.mock('../../src/esi-resilience/request-transport.js', () => ({ createEsiTransport: vi.fn() }))

const characterId = 1_404_328_063

beforeEach(() => {
  mocks.executeCharacterRepresentation.mockImplementation(async (_representation, resource) => {
    const loaded = await resource.load(
      { accessToken: 'access-token', principal: `character-${characterId}` },
      {},
    )
    return { data: loaded.data, cachedUntil: '', quota: {}, source: 'esi', stale: false }
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
    expect(mocks.executeCharacterRepresentation.mock.calls[0]?.[1]).toMatchObject({
      operation: 'character-corporation-roles',
      inputs: { path: { character_id: characterId } },
    })
    expect(mocks.getCorporationRoles).toHaveBeenCalledWith('GetCharactersCharacterIdRoles', {
      path: { character_id: characterId },
    })
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
