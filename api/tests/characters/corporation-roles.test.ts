import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeRepresentation: vi.fn(),
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
  esiExecutionLayer: { executeRepresentation: mocks.executeRepresentation },
}))

import { executeRepresentationFixture } from '../support/execute-representation.js'

const characterId = 1_404_328_063
const subjectLifecycleId = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  mocks.executeRepresentation.mockImplementation((representation, input) =>
    executeRepresentationFixture(representation, input, { accessToken: 'access-token' }),
  )
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

    await expect(getCharacterCorporationRoles(characterId, subjectLifecycleId)).resolves.toEqual({
      roles: ['Director', 'Accountant'],
      rolesAtBase: ['Factory_Manager'],
      rolesAtHeadquarters: ['Station_Manager'],
      rolesAtOther: ['Starbase_Defense_Operator'],
    })
    expect(characterCorporationRolesScope).toBe('esi-characters.read_corporation_roles.v1')
    expect(mocks.executeRepresentation.mock.calls[0]?.[1]).toEqual({ characterId })
    expect(mocks.getCorporationRoles).toHaveBeenCalledWith('GetCharactersCharacterIdRoles', {
      path: { character_id: characterId },
    })
  })

  test('normalizes absent role categories', async () => {
    mocks.getCorporationRoles.mockResolvedValue(response({}))
    const { getCharacterCorporationRoles } =
      await import('../../src/characters/corporation-roles.js')

    await expect(getCharacterCorporationRoles(characterId, subjectLifecycleId)).resolves.toEqual({
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
