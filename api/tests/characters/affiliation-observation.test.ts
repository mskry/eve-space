import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createCharacterClient: vi.fn(),
  createEsiTransport: vi.fn(),
  executeNoValue: vi.fn(),
  lookupAffiliations: vi.fn(),
}))

vi.mock('@evespace/esi-client/domains/character', () => ({
  createCharacterClient: mocks.createCharacterClient,
}))
vi.mock('../../src/esi-resilience/resilience.js', () => ({
  getEsiResilienceLayer: () => ({ executeNoValue: mocks.executeNoValue }),
}))
vi.mock('../../src/esi-resilience/transport.js', () => ({
  createEsiTransport: mocks.createEsiTransport,
}))

const characterId = 1_404_328_063
const validatedAt = '2026-08-31T12:00:00.000Z'

beforeEach(() => {
  mocks.createCharacterClient.mockReturnValue({
    withMetadata: () => ({ lookupAffiliations: mocks.lookupAffiliations }),
  })
  mocks.lookupAffiliations.mockResolvedValue({ data: [], meta: { headers: {} } })
  mocks.executeNoValue.mockImplementation(async (resource) => {
    const loaded = await resource.load()
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
    expect(mocks.executeNoValue.mock.calls[0]?.[0]).toMatchObject({
      operation: 'bulk-affiliation',
      inputs: { characterIds: [characterId] },
    })
  })
})
