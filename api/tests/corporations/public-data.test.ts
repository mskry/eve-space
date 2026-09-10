import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  callOperation: vi.fn(),
  executePublicRepresentation: vi.fn(),
  get: vi.fn(),
}))

vi.mock('@evespace/esi-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@evespace/esi-client')>()),
  EsiClient: class {
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

vi.mock('../../src/esi-resilience/request-transport.js', () => ({
  createEsiTransport: vi.fn(),
}))

vi.mock('../../src/universe/resolution-cache.js', () => ({
  readUniverseNames: () => ({ fresh: new Map(), stale: new Map(), suppressed: new Set() }),
  writeUniverseNames: vi.fn(),
  suppressUniverseNameIds: vi.fn(),
}))

beforeEach(() => {
  mocks.executePublicRepresentation.mockImplementation((_representation, resource) =>
    mocks.get(resource),
  )
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
  mocks.callOperation.mockImplementation((operationId: string) => {
    switch (operationId) {
      case 'GetCorporationsCorporationId':
        return response({ member_count: 10, name: 'Test', ticker: 'TEST' })
      case 'GetCorporationsCorporationIdAlliancehistory':
        return response([])
      case 'GetCorporationsNpccorps':
        return response([1, 2])
      case 'PostUniverseNames':
        return response([])
      default:
        throw new Error(`Unexpected operation ${operationId}`)
    }
  })
})

describe('corporation service', () => {
  test('maps public data while issuing each ESI read through its registered resource', async () => {
    await expect(
      import('../../src/corporations/public-data.js').then(({ getCorporationPublic }) =>
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
    const { getCorporationPublic } = await import('../../src/corporations/public-data.js')

    await expect(getCorporationPublic(90_000_002)).rejects.toMatchObject({ status: 404 })
  })

  test('does not produce a cacheable corporation DTO when name resolution is transiently unavailable', async () => {
    mocks.callOperation.mockImplementation((operationId: string) => {
      if (operationId === 'GetCorporationsCorporationId')
        return response({ alliance_id: 99, member_count: 10, name: 'Test', ticker: 'TEST' })
      if (operationId === 'PostUniverseNames')
        return Promise.reject(Object.assign(new Error('Unavailable'), { status: 503 }))
      throw new Error(`Unexpected operation ${operationId}`)
    })
    const { getCorporationPublic } = await import('../../src/corporations/public-data.js')

    await expect(getCorporationPublic(90_000_002)).rejects.toMatchObject({ status: 503 })
  })

  test('surfaces a 404 for an unknown corporation without caching a negative lookup', async () => {
    // The representation's map only runs on a successful call, so a 404 can no longer be cached as
    // a validated negative result: every lookup of an unknown ID re-queries ESI.
    mocks.callOperation.mockImplementation((operationId: string) => {
      if (operationId === 'GetCorporationsCorporationId')
        return Promise.reject(Object.assign(new Error('Not found'), { status: 404 }))
      throw new Error(`Unexpected operation ${operationId}`)
    })
    const { getCorporationPublic } = await import('../../src/corporations/public-data.js')

    await expect(getCorporationPublic(90_000_004)).rejects.toMatchObject({ status: 404 })
    await expect(getCorporationPublic(90_000_004)).rejects.toMatchObject({ status: 404 })
    expect(
      mocks.callOperation.mock.calls.filter(
        ([operationId]) => operationId === 'GetCorporationsCorporationId',
      ),
    ).toHaveLength(2)
  })

  test('uses separate policies for alliance history and NPC corporations', async () => {
    const { getCorporationAllianceHistory, getNpcCorporations } =
      await import('../../src/corporations/public-data.js')

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
