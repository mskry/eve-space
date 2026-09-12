import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createFeatureExecutionMock } from '../support/mock-feature-execution.js'

const mocks = vi.hoisted(() => ({
  executeRepresentation: vi.fn(),
  lookupAffiliations: vi.fn(),
}))

vi.mock('../../src/esi-gateway/feature-execution.js', () =>
  createFeatureExecutionMock(mocks.executeRepresentation),
)

const characterId = 1_404_328_063
const validatedAt = '2026-08-31T12:00:00.000Z'

beforeEach(() => {
  mocks.lookupAffiliations.mockResolvedValue({
    data: [],
    cachedUntil: '2026-08-31T13:00:00.000Z',
    validatedAt,
    source: 'cache',
    stale: false,
    quota: {},
  })
  mocks.executeRepresentation.mockImplementation((_, input) => mocks.lookupAffiliations(input))
})

describe('character affiliation observation', () => {
  test('retains bulk-affiliation validation time and stale metadata before local persistence', async () => {
    mocks.lookupAffiliations.mockResolvedValue({
      data: [{ characterId, corporationId: 98_000_001, allianceId: 99_000_001 }],
      cachedUntil: '2026-08-31T13:00:00.000Z',
      validatedAt,
      source: 'cache',
      stale: true,
      quota: {},
    })
    const { observeCharacterAffiliation } = await import('../../src/characters/affiliation-sync.js')
    const controller = new AbortController()

    await expect(observeCharacterAffiliation(characterId, controller.signal)).resolves.toEqual({
      characterId,
      corporationId: 98_000_001,
      allianceId: 99_000_001,
      affiliationCheckedAt: new Date(validatedAt),
      stale: true,
    })
    expect(mocks.executeRepresentation.mock.calls[0]?.[1]).toEqual({
      body: [characterId],
      signal: controller.signal,
    })
    expect(mocks.executeRepresentation.mock.calls[0]?.[2]).toEqual({ signal: controller.signal })
    expect(mocks.lookupAffiliations).toHaveBeenCalledWith({
      body: [characterId],
      signal: controller.signal,
    })
  })
})
