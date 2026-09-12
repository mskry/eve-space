import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createFeatureExecutionMock } from '../support/mock-feature-execution.js'

const mocks = vi.hoisted(() => ({
  executeRepresentation: vi.fn(),
  getCorporationRoles: vi.fn(),
}))

vi.mock('../../src/esi-gateway/feature-execution.js', () =>
  createFeatureExecutionMock(mocks.executeRepresentation),
)

const characterId = 1_404_328_063
const subjectLifecycleId = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  mocks.executeRepresentation.mockImplementation((_definition, input) =>
    mocks.getCorporationRoles(input),
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
    expect(mocks.executeRepresentation.mock.calls[0]?.[1]).toEqual({
      characterId,
      subjectLifecycleId,
    })
    expect(mocks.getCorporationRoles).toHaveBeenCalledWith({ characterId, subjectLifecycleId })
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
  const value = data as Data & {
    roles?: string[]
    roles_at_base?: string[]
    roles_at_hq?: string[]
    roles_at_other?: string[]
  }
  return {
    data: {
      roles: value.roles ?? [],
      rolesAtBase: value.roles_at_base ?? [],
      rolesAtHeadquarters: value.roles_at_hq ?? [],
      rolesAtOther: value.roles_at_other ?? [],
    },
    cachedUntil: '',
    validatedAt: '',
    quota: {},
    source: 'esi' as const,
    stale: false,
  }
}
