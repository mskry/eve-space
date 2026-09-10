import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  callOperation: vi.fn(),
  executeRepresentation: vi.fn(),
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
  esiExecutionLayer: { executeRepresentation: mocks.executeRepresentation },
}))

vi.mock('../../src/universe/resolution-cache.js', () => ({
  readUniverseNames: () => ({ fresh: new Map(), stale: new Map(), suppressed: new Set() }),
  writeUniverseNames: vi.fn(),
  suppressUniverseNameIds: vi.fn(),
}))

import { executeRepresentationFixture } from '../support/execute-representation.js'

beforeEach(() => {
  mocks.executeRepresentation.mockImplementation(async (representation, input) => {
    const loaded = await executeRepresentationFixture(representation, input)
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

    expect(
      mocks.executeRepresentation.mock.calls.map(([representation]) => representation.operation),
    ).toEqual(['public-corporation'])
  })

  test('keeps the public 404 outcome from the resilient resource', async () => {
    mocks.executeRepresentation.mockRejectedValueOnce(
      Object.assign(new Error('Not found'), { status: 404 }),
    )
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

  test('resolves an unknown corporation into a cacheable negative lookup', async () => {
    mocks.callOperation.mockImplementation((operationId: string) => {
      if (operationId === 'GetCorporationsCorporationId')
        return Promise.reject(Object.assign(new Error('Not found'), { status: 404 }))
      throw new Error(`Unexpected operation ${operationId}`)
    })
    let loaded: { data: unknown } | undefined
    mocks.executeRepresentation.mockImplementation(async (representation, input) => {
      const result = await executeRepresentationFixture(representation, input)
      loaded = { data: result.data }
      return { ...result, cachedUntil: '2026-08-22T12:01:00.000Z' }
    })
    const { getCorporationPublic } = await import('../../src/corporations/public-data.js')

    await expect(getCorporationPublic(90_000_004)).rejects.toMatchObject({ status: 404 })
    expect(loaded).toMatchObject({ data: { found: false } })
  })

  test('uses separate policies for alliance history and NPC corporations', async () => {
    const { getCorporationAllianceHistory, getNpcCorporations } =
      await import('../../src/corporations/public-data.js')

    await getCorporationAllianceHistory(90_000_003)
    await expect(getNpcCorporations()).resolves.toEqual([1, 2])

    expect(
      mocks.executeRepresentation.mock.calls.map(([representation]) => representation.operation),
    ).toEqual(['corporation-alliance-history', 'corporation-npc-list'])
  })
})

function response<Data>(data: Data) {
  return { data, meta: { headers: {} } }
}
