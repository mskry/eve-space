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
    cachedUntil: '2026-08-31T13:00:00.000Z',
    data: [],
    quota: {},
    source: 'cache',
    stale: false,
    validatedAt,
  })
  mocks.executeRepresentation.mockImplementation((_, input) => mocks.lookupAffiliations(input))
})

describe('character affiliation observation', () => {
  test('retains bulk-affiliation validation time and stale metadata before local persistence', async () => {
    mocks.lookupAffiliations.mockResolvedValue({
      cachedUntil: '2026-08-31T13:00:00.000Z',
      data: [{ characterId, corporationId: 98_000_001, allianceId: 99_000_001 }],
      quota: {},
      source: 'cache',
      stale: true,
      validatedAt,
    })
    const { observeCharacterAffiliation } = await import('../../src/characters/affiliation-sync.js')
    const controller = new AbortController()

    await expect(
      observeCharacterAffiliation(characterId, controller.signal),
    ).resolves.toStrictEqual({
      affiliationCheckedAt: new Date(validatedAt),
      affiliationFreshUntil: new Date('2026-08-31T13:00:00.000Z'),
      allianceId: 99_000_001,
      characterId,
      corporationId: 98_000_001,
      stale: true,
    })
    expect(mocks.executeRepresentation.mock.calls[0]?.[1]).toStrictEqual({
      body: [characterId],
      signal: controller.signal,
    })
    expect(mocks.executeRepresentation.mock.calls[0]?.[2]).toStrictEqual({
      signal: controller.signal,
    })
    expect(mocks.lookupAffiliations).toHaveBeenCalledWith({
      body: [characterId],
      signal: controller.signal,
    })
  })
})
