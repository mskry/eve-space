import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeRepresentation: vi.fn(),
  lookupAffiliations: vi.fn(),
}))

vi.mock('@evespace/esi-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@evespace/esi-client')>()),
  EsiClient: class {
    callOperation(...arguments_: unknown[]) {
      return mocks.lookupAffiliations(...arguments_)
    }
  },
}))
vi.mock('../../src/esi-resilience/layer.js', () => ({
  esiExecutionLayer: { executeRepresentation: mocks.executeRepresentation },
}))

import { executeRepresentationFixture } from '../support/execute-representation.js'

const characterId = 1_404_328_063
const validatedAt = '2026-08-31T12:00:00.000Z'

beforeEach(() => {
  mocks.lookupAffiliations.mockResolvedValue({ data: [], meta: { headers: {} } })
  mocks.executeRepresentation.mockImplementation(async (representation, input) => {
    const loaded = await executeRepresentationFixture(representation, input)
    return {
      data: loaded.data,
      cachedUntil: '2026-08-31T13:00:00.000Z',
      validatedAt,
      source: 'cache',
      stale: false,
      quota: {},
    }
  })
})

describe('character affiliation observation', () => {
  test('retains the bulk-affiliation validation time when reading from cache', async () => {
    mocks.lookupAffiliations.mockResolvedValue({
      data: [{ character_id: characterId, corporation_id: 98_000_001, alliance_id: 99_000_001 }],
      meta: { headers: {} },
    })
    const { getCharacterAffiliationObservation } =
      await import('../../src/characters/affiliation-sync.js')

    await expect(getCharacterAffiliationObservation(characterId)).resolves.toEqual({
      characterId,
      corporationId: 98_000_001,
      allianceId: 99_000_001,
      affiliationCheckedAt: new Date(validatedAt),
      stale: false,
    })
    expect(mocks.executeRepresentation.mock.calls[0]?.[1]).toEqual({ body: [characterId] })
    expect(mocks.lookupAffiliations).toHaveBeenCalledWith('PostCharactersAffiliation', {
      body: [characterId],
    })
  })
})
