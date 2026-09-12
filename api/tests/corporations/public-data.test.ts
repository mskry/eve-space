import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createFeatureExecutionMock } from '../support/mock-feature-execution.js'

const mocks = vi.hoisted(() => ({ executeRepresentation: vi.fn() }))

vi.mock('../../src/esi-gateway/feature-execution.js', () =>
  createFeatureExecutionMock(mocks.executeRepresentation),
)

const freshness = {
  cachedUntil: '2026-08-22T12:01:00.000Z',
  validatedAt: '2026-08-22T12:00:00.000Z',
  quota: {},
  source: 'esi' as const,
  stale: false,
}

const corporation = {
  name: 'Test',
  ticker: 'TEST',
  memberCount: 10,
  ceoId: null,
  ceoName: null,
  creatorId: null,
  creatorName: null,
  taxRate: null,
  dateFounded: null,
  description: null,
  url: null,
  factionId: null,
  homeStationId: null,
  homeStationName: null,
  shares: null,
  allianceId: null,
  allianceName: null,
  type: 'unknown',
  state: 'unknown',
  warEligible: null,
}

beforeEach(() => {
  mocks.executeRepresentation.mockImplementation((definition) => {
    if (definition.operation === 'public-corporation')
      return Promise.resolve(result({ found: true, corporation }))
    if (definition.operation === 'corporation-alliance-history') return Promise.resolve(result([]))
    return Promise.resolve(result([1, 2]))
  })
})

describe('corporation service', () => {
  test('uses the mapped public corporation callable result', async () => {
    const { getCorporationPublic } = await import('../../src/corporations/public-data.js')

    await expect(getCorporationPublic(90_000_001)).resolves.toMatchObject({
      corporationId: 90_000_001,
      name: 'Test',
      ticker: 'TEST',
      memberCount: 10,
    })
    expect(mocks.executeRepresentation).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'public-corporation' }),
      { corporationId: 90_000_001 },
      undefined,
    )
  })

  test('keeps callable 404 failures and converts mapped negative results to not-found', async () => {
    mocks.executeRepresentation.mockRejectedValueOnce(
      Object.assign(new Error('Not found'), { status: 404 }),
    )
    const { getCorporationPublic } = await import('../../src/corporations/public-data.js')
    await expect(getCorporationPublic(90_000_002)).rejects.toMatchObject({ status: 404 })

    mocks.executeRepresentation.mockResolvedValueOnce(result({ found: false }))
    await expect(getCorporationPublic(90_000_004)).rejects.toMatchObject({ status: 404 })
  })

  test('keeps independent callable policies for history and NPC corporations', async () => {
    const { getCorporationAllianceHistory, getNpcCorporations } =
      await import('../../src/corporations/public-data.js')

    await expect(getCorporationAllianceHistory(90_000_003)).resolves.toEqual([])
    await expect(getNpcCorporations()).resolves.toEqual([1, 2])
    expect(
      mocks.executeRepresentation.mock.calls.map(([definition]) => definition.operation),
    ).toEqual(['corporation-alliance-history', 'corporation-npc-list'])
  })
})

function result<Data>(data: Data) {
  return { data, ...freshness }
}
