import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  callOperation: vi.fn(),
  createEsiClient: vi.fn(),
  executePublicRepresentation: vi.fn(),
  get: vi.fn(),
}))

vi.mock('@evespace/esi-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@evespace/esi-client')>()),
  EsiClient: class {
    constructor(options: unknown) {
      mocks.createEsiClient(options)
    }

    callOperation(...arguments_: unknown[]) {
      return mocks.callOperation(...arguments_)
    }
  },
}))
vi.mock('../../src/esi-resilience/layer.js', () => ({
  getEsiResilienceLayer: () => ({
    executePublicRepresentation: mocks.executePublicRepresentation,
    getPublic: mocks.get,
  }),
}))
vi.mock('../../src/esi-resilience/request-transport.js', () => ({ createEsiTransport: vi.fn() }))

const character = {
  achievement_score: 0,
  alliance_id: 99_000_001,
  birthday: '2008-01-31T00:00:00Z',
  bloodline_id: 5,
  corporation_id: 1_000_166,
  description: String.raw`<font color="#ffffff">u'고생 끝에 낙이 온다'</font>`,
  gender: 'female',
  name: 'Bandera Primary',
  race_id: 4,
  security_status: -0.3,
}
const esiMetadata = {
  cachedUntil: '2026-08-20T12:01:00.000Z',
  validatedAt: '2026-08-20T12:00:00.000Z',
  quota: {},
  source: 'esi' as const,
  stale: false,
}
const publicMetadata = {
  cachedUntil: esiMetadata.cachedUntil,
  validatedAt: esiMetadata.validatedAt,
  stale: false,
}
const getUniverseBloodlinesNullableShipTypeIdFixture = [
  {
    bloodline_id: 5,
    charisma: 3,
    corporation_id: 1_000_166,
    description: 'Observed live bloodline response',
    intelligence: 7,
    memory: 4,
    name: 'Khanid',
    perception: 8,
    race_id: 4,
    ship_type_id: null,
    willpower: 7,
  },
]

beforeEach(() => {
  mocks.executePublicRepresentation.mockImplementation((_representation, resource) =>
    mocks.get(resource),
  )
  mocks.get.mockImplementation(async (resource) => {
    const loaded = await resource.load({})
    return {
      data: loaded.data,
      ...esiMetadata,
    }
  })
  mocks.callOperation.mockImplementation((operationId: string) => {
    switch (operationId) {
      case 'GetCharactersDetail':
        return response(character)
      case 'GetCorporationsCorporationId':
        return response({ member_count: 1, name: 'Imperial Academy', ticker: 'IAC' })
      case 'GetUniverseRaces':
        return response([{ name: 'Amarr', race_id: 4 }])
      case 'GetUniverseBloodlines':
        return response(getUniverseBloodlinesNullableShipTypeIdFixture)
      case 'GetAlliancesAllianceId':
        return response({ name: 'Alliance', ticker: 'ALLY' })
      default:
        throw new Error(`Unexpected operation ${operationId}`)
    }
  })
})

describe('character profile', () => {
  test('keeps the GetUniverseBloodlines nullable ship_type_id override operation-specific', async () => {
    const { getCharacterProfile } = await import('../../src/characters/profile.js')

    await expect(getCharacterProfile(90_000_001)).resolves.toMatchObject({ bloodline: 'Khanid' })

    const validateResponsesByOperation = new Map(
      mocks.callOperation.mock.calls.map((call, index) => [
        call[0] as string,
        (
          mocks.createEsiClient.mock.calls[index]?.[0] as
            | { validateResponses?: boolean }
            | undefined
        )?.validateResponses,
      ]),
    )
    expect(validateResponsesByOperation.get('GetUniverseRaces')).toBe(true)
    expect(validateResponsesByOperation.get('GetUniverseBloodlines')).toBe(false)
  })

  test('composes independently resilient public resources without changing the DTO', async () => {
    const { getCharacterProfile } = await import('../../src/characters/profile.js')

    await expect(getCharacterProfile(90_000_001)).resolves.toMatchObject({
      id: 90_000_001,
      name: 'Bandera Primary',
      bio: '고생 끝에 낙이 온다',
      corporation: { id: 1_000_166, name: 'Imperial Academy', ticker: 'IAC', memberCount: 1 },
      ...publicMetadata,
    })
    expect(mocks.get.mock.calls.map(([resource]) => resource.operation)).toEqual([
      'public-character',
      'public-corporation',
      'universe-races',
      'universe-bloodlines',
      'public-alliance',
    ])
  })

  test('reports the oldest validation and staleness across every profile resource', async () => {
    const validatedAtByOperation: Record<string, string> = {
      'public-character': '2026-08-20T12:00:00.000Z',
      'public-corporation': '2026-08-20T11:59:00.000Z',
      'universe-races': '2026-08-20T11:58:00.000Z',
      'universe-bloodlines': '2026-08-20T11:57:00.000Z',
      'public-alliance': '2026-08-20T11:56:00.000Z',
    }
    mocks.get.mockImplementation(async (resource) => {
      const loaded = await resource.load({})
      const stale = resource.operation === 'universe-bloodlines'
      return {
        data: loaded.data,
        cachedUntil: '2026-08-20T12:01:00.000Z',
        validatedAt: validatedAtByOperation[resource.operation],
        quota: { remaining: 12 },
        source: 'cache',
        stale,
        ...(stale ? { refreshFailureClass: 'response-invalid' } : {}),
      }
    })
    const { getCharacterProfile } = await import('../../src/characters/profile.js')

    const profile = await getCharacterProfile(90_000_001)

    expect(profile).toMatchObject({
      cachedUntil: '2026-08-20T12:01:00.000Z',
      validatedAt: '2026-08-20T11:56:00.000Z',
      stale: true,
      refreshFailureClass: 'response-invalid',
    })
    expect(profile).not.toHaveProperty('source')
    expect(profile).not.toHaveProperty('quota')
  })

  test.each(['profile-first', 'deployment-first'] as const)(
    'shares one mapped corporation representation across consumers with %s ordering',
    async (ordering) => {
      const cache = new Map<string, unknown>()
      mocks.get.mockImplementation(async (resource) => {
        const key = JSON.stringify([resource.operation, resource.inputs])
        if (cache.has(key))
          return {
            data: cache.get(key),
            cachedUntil: '',
            validatedAt: '2026-08-20T12:00:00.000Z',
            quota: {},
            source: 'cache',
            stale: false,
          }
        const loaded = await resource.load({})
        cache.set(key, loaded.data)
        return {
          data: loaded.data,
          cachedUntil: '',
          validatedAt: '2026-08-20T12:00:00.000Z',
          quota: {},
          source: 'esi',
          stale: false,
        }
      })
      const [{ getCharacterProfile }, { getCorporationPublic }, { resolveDeploymentOrganization }] =
        await Promise.all([
          import('../../src/characters/profile.js'),
          import('../../src/corporations/public-data.js'),
          import('../../src/deployment/organization.js'),
        ])

      const expectProfile = () =>
        expect(getCharacterProfile(90_000_001)).resolves.toMatchObject({
          corporation: { name: 'Imperial Academy', memberCount: 1 },
        })
      const expectDeployment = () =>
        expect(
          resolveDeploymentOrganization('corporation', character.corporation_id),
        ).resolves.toMatchObject({ name: 'Imperial Academy', ticker: 'IAC' })
      if (ordering === 'profile-first') {
        await expectProfile()
        await expectDeployment()
      } else {
        await expectDeployment()
        await expectProfile()
      }
      await expect(getCorporationPublic(character.corporation_id)).resolves.toMatchObject({
        name: 'Imperial Academy',
        memberCount: 1,
      })
      expect(
        mocks.callOperation.mock.calls.filter(
          ([operationId]) => operationId === 'GetCorporationsCorporationId',
        ),
      ).toHaveLength(1)
    },
  )
})

function response<Data>(data: Data) {
  return { data, meta: { headers: {} } }
}
