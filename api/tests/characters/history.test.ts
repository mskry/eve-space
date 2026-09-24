import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createFeatureExecutionMock } from '../support/mock-feature-execution.js'

const mocks = vi.hoisted(() => ({
  callOperation: vi.fn(),
  executeRepresentation: vi.fn(),
}))

vi.mock('../../src/esi-gateway/feature-execution.js', () =>
  createFeatureExecutionMock(mocks.executeRepresentation),
)
vi.mock('../../src/universe/resolution-cache.js', () => ({
  readUniverseNames: () => ({ fresh: new Map(), stale: new Map(), suppressed: new Set() }),
  suppressUniverseNameIds: vi.fn(),
  writeUniverseNames: vi.fn(),
}))

const employmentHistoryFixture = [
  {
    corporation: { id: 2, isNpc: true, name: 'Second Corporation' },
    isDeleted: false,
    recordId: 2,
    startDate: '2020-01-01T00:00:00Z',
  },
  {
    corporation: { id: 1, isNpc: true, name: 'First Corporation' },
    isDeleted: false,
    recordId: 1,
    startDate: '2024-01-01T00:00:00Z',
  },
]

beforeEach(() => {
  mocks.executeRepresentation.mockResolvedValue(response(employmentHistoryFixture))
})

describe('character employment history service', () => {
  test('maps history using callable employment and name reads', async () => {
    const { getCharacterEmploymentHistory } = await import('../../src/characters/history.js')

    await expect(getCharacterEmploymentHistory(90_000_101)).resolves.toStrictEqual([
      {
        corporation: { id: 2, isNpc: true, name: 'Second Corporation' },
        isDeleted: false,
        recordId: 2,
        startDate: '2020-01-01T00:00:00Z',
      },
      {
        corporation: { id: 1, isNpc: true, name: 'First Corporation' },
        isDeleted: false,
        recordId: 1,
        startDate: '2024-01-01T00:00:00Z',
      },
    ])
    expect(mocks.executeRepresentation.mock.calls[0]?.[0]).toMatchObject({
      operation: 'employment-history',
    })
  })

  test('does not produce cacheable unknown names after a transient resolution failure', async () => {
    mocks.executeRepresentation.mockRejectedValue(
      Object.assign(new Error('Unavailable'), { status: 503 }),
    )
    const { getCharacterEmploymentHistory } = await import('../../src/characters/history.js')

    await expect(getCharacterEmploymentHistory(90_000_101)).rejects.toMatchObject({ status: 503 })
  })

  test('preserves stale read metadata for route callers', async () => {
    mocks.executeRepresentation.mockResolvedValue({
      ...response(employmentHistoryFixture),
      refreshFailureClass: 'esi-unavailable',
      retryAt: '2026-08-20T12:05:00.000Z',
      stale: true,
      validatedAt: '2026-08-20T11:55:00.000Z',
    })
    const { getCharacterEmploymentHistoryResult } = await import('../../src/characters/history.js')

    await expect(getCharacterEmploymentHistoryResult(90_000_101)).resolves.toMatchObject({
      data: employmentHistoryFixture,
      refreshFailureClass: 'esi-unavailable',
      retryAt: '2026-08-20T12:05:00.000Z',
      stale: true,
      validatedAt: '2026-08-20T11:55:00.000Z',
    })
  })
})

function response<Data>(data: Data) {
  return {
    cachedUntil: '2026-08-20T12:01:00.000Z',
    data,
    quota: {},
    source: 'esi' as const,
    stale: false,
    validatedAt: '',
  }
}
