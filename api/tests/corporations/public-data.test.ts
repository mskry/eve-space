import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createFeatureExecutionMock } from '../support/mock-feature-execution.js'

const mocks = vi.hoisted(() => ({ executeRepresentation: vi.fn() }))

vi.mock('../../src/esi-gateway/feature-execution.js', () =>
  createFeatureExecutionMock(mocks.executeRepresentation),
)

const freshness = {
  cachedUntil: '2026-08-22T12:01:00.000Z',
  quota: {},
  source: 'esi' as const,
  stale: false,
  validatedAt: '2026-08-22T12:00:00.000Z',
}

const corporation = {
  allianceId: null,
  allianceName: null,
  ceoId: null,
  ceoName: null,
  creatorId: null,
  creatorName: null,
  dateFounded: null,
  description: null,
  factionId: null,
  friendlyFire: 'illegal',
  homeStationId: null,
  homeStationName: null,
  loyaltyPointTaxRate: 2.5,
  memberCount: 10,
  name: 'Test',
  shares: null,
  state: 'active',
  taxRate: 7.5,
  ticker: 'TEST',
  type: 'player_owned',
  url: null,
  warEligible: true,
}

beforeEach(() => {
  mocks.executeRepresentation.mockImplementation((definition) => {
    if (definition.operation === 'public-corporation') {
      return Promise.resolve(result({ corporation, found: true }))
    }
    if (definition.operation === 'corporation-alliance-history') {
      return Promise.resolve(result([]))
    }
    return Promise.resolve(result([1, 2]))
  })
})

describe('corporation service', () => {
  test('uses the mapped public corporation callable result', async () => {
    const { getCorporationPublic } = await import('../../src/corporations/public-data.js')

    await expect(getCorporationPublic(90_000_001)).resolves.toMatchObject({
      corporationId: 90_000_001,
      memberCount: 10,
      name: 'Test',
      ticker: 'TEST',
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

    await expect(getCorporationAllianceHistory(90_000_003)).resolves.toStrictEqual([])
    await expect(getNpcCorporations()).resolves.toStrictEqual([1, 2])
    expect(
      mocks.executeRepresentation.mock.calls.map(([definition]) => definition.operation),
    ).toStrictEqual(['corporation-alliance-history', 'corporation-npc-list'])
  })

  test('preserves stale metadata on public corporation and alliance-history results', async () => {
    mocks.executeRepresentation.mockImplementation((definition) => {
      const data =
        definition.operation === 'public-corporation'
          ? { corporation, found: true }
          : definition.operation === 'corporation-alliance-history'
            ? []
            : [1, 2]
      return Promise.resolve({
        ...result(data),
        refreshFailureClass: 'esi-unavailable',
        retryAt: '2026-08-22T12:05:00.000Z',
        stale: true,
        validatedAt: '2026-08-22T11:55:00.000Z',
      })
    })
    const { getCorporationAllianceHistoryResult, getCorporationPublicResult } =
      await import('../../src/corporations/public-data.js')

    const [corporationResult, historyResult] = await Promise.all([
      getCorporationPublicResult(90_000_001),
      getCorporationAllianceHistoryResult(90_000_001),
    ])
    expect(corporationResult).toMatchObject({
      data: { corporationId: 90_000_001 },
      refreshFailureClass: 'esi-unavailable',
      retryAt: '2026-08-22T12:05:00.000Z',
      stale: true,
      validatedAt: '2026-08-22T11:55:00.000Z',
    })
    expect(historyResult).toMatchObject({
      data: [],
      refreshFailureClass: 'esi-unavailable',
      retryAt: '2026-08-22T12:05:00.000Z',
      stale: true,
      validatedAt: '2026-08-22T11:55:00.000Z',
    })
  })
})

function result<Data>(data: Data) {
  return { data, ...freshness }
}
