import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  getPublicInfo: vi.fn(),
  listAllianceHistory: vi.fn(),
  listNpcCorporations: vi.fn(),
  resolveNames: vi.fn(),
}))

vi.mock('@evespace/esi-client/domains/corporation', () => ({
  createCorporationClient: () => ({
    withMetadata: () => ({
      getPublicInfo: mocks.getPublicInfo,
      listAllianceHistory: mocks.listAllianceHistory,
      listNpcCorporations: mocks.listNpcCorporations,
    }),
  }),
}))

vi.mock('@evespace/esi-client/domains/universe', () => ({
  createUniverseClient: () => ({
    withMetadata: () => ({ resolveNames: mocks.resolveNames }),
  }),
}))

vi.mock('../src/esi-resilience/resilience.js', () => ({
  getEsiResilienceLayer: () => ({ get: mocks.get }),
}))

vi.mock('../src/esi-resilience/transport.js', () => ({
  createEsiTransport: vi.fn(),
}))

beforeEach(() => {
  mocks.get.mockImplementation(async (resource) => {
    const loaded = await resource.load({})
    return {
      data: loaded.data,
      cachedUntil: '2026-08-22T12:01:00.000Z',
      quota: {},
      source: 'esi',
      stale: false,
    }
  })
  mocks.getPublicInfo.mockResolvedValue(
    response({ member_count: 10, name: 'Test', ticker: 'TEST' }),
  )
  mocks.listAllianceHistory.mockResolvedValue(response([]))
  mocks.listNpcCorporations.mockResolvedValue(response([1, 2]))
  mocks.resolveNames.mockResolvedValue(response([]))
})

describe('corporation service', () => {
  test('maps public data while issuing each ESI read through its registered resource', async () => {
    await expect(
      import('../src/corporation-service.js').then(({ getCorporationPublic }) =>
        getCorporationPublic(90_000_001),
      ),
    ).resolves.toMatchObject({
      corporationId: 90_000_001,
      name: 'Test',
      ticker: 'TEST',
      memberCount: 10,
    })

    expect(mocks.get.mock.calls.map(([resource]) => resource.operation)).toEqual([
      'public-corporation',
    ])
  })

  test('keeps the public 404 outcome from the resilient resource', async () => {
    mocks.get.mockRejectedValueOnce(Object.assign(new Error('Not found'), { status: 404 }))
    const { getCorporationPublic } = await import('../src/corporation-service.js')

    await expect(getCorporationPublic(90_000_002)).rejects.toMatchObject({ status: 404 })
  })

  test('uses separate policies for alliance history and NPC corporations', async () => {
    const { getCorporationAllianceHistory, getNpcCorporations } =
      await import('../src/corporation-service.js')

    await getCorporationAllianceHistory(90_000_003)
    await expect(getNpcCorporations()).resolves.toEqual([1, 2])

    expect(mocks.get.mock.calls.map(([resource]) => resource.operation)).toEqual([
      'corporation-alliance-history',
      'corporation-npc-list',
    ])
  })
})

function response<Data>(data: Data) {
  return { data, meta: { headers: {} } }
}
