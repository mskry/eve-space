import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createFeatureExecutionMock } from '../support/mock-feature-execution.js'

const mocks = vi.hoisted(() => ({
  definitions: [] as unknown[],
  executeRepresentation: vi.fn(),
}))

vi.mock('../../src/esi-gateway/feature-execution.js', () => {
  const mock = createFeatureExecutionMock(mocks.executeRepresentation)
  return {
    ...mock,
    createCharacterEsiRead: (definition: { readonly operation: string }) => {
      mocks.definitions.push(definition)
      return mock.createCharacterEsiRead(definition)
    },
  }
})

const characterId = 1_404_328_063
const subjectLifecycleId = '11111111-1111-4111-8111-111111111111'
const affiliationPeriodRevision = '22222222-2222-4222-8222-222222222222'
const input = { affiliationPeriodRevision, characterId, subjectLifecycleId }

beforeEach(() => {
  mocks.executeRepresentation.mockReset()
})

describe('character corporation roles', () => {
  test('returns canonical role sets with generation and freshness metadata', async () => {
    mocks.executeRepresentation.mockResolvedValue({
      authorizationGeneration: 4,
      cachedUntil: '2026-09-25T13:00:00.000Z',
      data: {
        roles: ['Director', 'Accountant', 'Director'],
        rolesAtBase: ['Factory_Manager'],
        rolesAtHeadquarters: [],
        rolesAtOther: ['Trader', 'Auditor'],
      },
      quota: {},
      retryAt: '2026-09-25T12:05:00.000Z',
      source: 'not-modified',
      stale: false,
      validatedAt: '2026-09-25T12:00:00.000Z',
    })
    const { characterCorporationRolesScope, readCharacterCorporationRoles } =
      await import('../../src/characters/corporation-roles.js')

    await expect(readCharacterCorporationRoles(input)).resolves.toStrictEqual({
      authorizationGeneration: 4,
      cachedUntil: new Date('2026-09-25T13:00:00.000Z'),
      retryAt: new Date('2026-09-25T12:05:00.000Z'),
      roles: {
        roles: ['Accountant', 'Director'],
        rolesAtBase: ['Factory_Manager'],
        rolesAtHeadquarters: [],
        rolesAtOther: ['Auditor', 'Trader'],
      },
      stale: false,
      validatedAt: new Date('2026-09-25T12:00:00.000Z'),
    })
    expect(characterCorporationRolesScope).toBe('esi-characters.read_corporation_roles.v1')
    expect(mocks.executeRepresentation.mock.calls[0]?.[1]).toStrictEqual(input)
  })

  test('encodes only the character upstream while the cache identity carries the period', async () => {
    await import('../../src/characters/corporation-roles.js')
    const definition = mocks.definitions.find(
      (
        candidate,
      ): candidate is {
        readonly cacheIdentity: (value: typeof input) => unknown
        readonly encodeRequest: (value: typeof input) => unknown
        readonly map: (response: { readonly data: unknown }) => unknown
      } =>
        typeof candidate === 'object' &&
        candidate !== null &&
        'operation' in candidate &&
        candidate.operation === 'character-corporation-roles',
    )
    if (!definition) {
      throw new Error('Missing corporation-role representation')
    }

    expect(definition.encodeRequest(input)).toStrictEqual({ path: { character_id: characterId } })
    expect(definition.cacheIdentity(input)).toStrictEqual({
      affiliationPeriodRevision,
      characterId,
    })
    expect(definition.map({ data: {} })).toStrictEqual({
      roles: [],
      rolesAtBase: [],
      rolesAtHeadquarters: [],
      rolesAtOther: [],
    })
  })
})
