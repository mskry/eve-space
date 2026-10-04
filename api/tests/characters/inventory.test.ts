import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import type { AssetSnapshot } from '@eve-space/core-eve-projections/assets'
import type { PlatformAdmittedPersonalInventory } from '@eve-space/platform-module-contract/inventory'
import type {
  PersonalInventoryBinding,
  PersonalInventorySubject,
} from '../../src/auth/inventory-admission.js'
import { createFeatureExecutionMock } from '../support/mock-feature-execution.js'

const mocks = vi.hoisted(() => {
  const query = { from: vi.fn(), leftJoin: vi.fn(), where: vi.fn(), limit: vi.fn() }
  return { execute: vi.fn(), query, names: vi.fn(), locations: vi.fn() }
})
vi.mock('../../src/esi-gateway/feature-execution.js', () =>
  createFeatureExecutionMock(mocks.execute),
)
vi.mock('../../src/db/client.js', () => ({ db: { select: vi.fn(() => mocks.query) } }))
vi.mock('../../src/universe/names.js', () => ({ resolveUniverseNamesBestEffort: mocks.names }))
vi.mock('../../src/universe/static-locations.js', () => ({ getStaticLocations: mocks.locations }))

import {
  readPersonalInventorySources,
  InventorySourceLimitError,
  InventorySourceRestartError,
  assertPersonalInventorySourceCurrent,
} from '../../src/characters/inventory-source.js'
import { enrichInventoryItems } from '../../src/characters/inventory-enrichment.js'
import { reducePersonalInventory } from '../../src/characters/inventory-reduction.js'
import { immediateAssetWork } from '../../src/characters/asset-work.js'
import { GraphQLRequestState } from '../../src/graphql/request-state.js'
import { GraphQLError } from 'graphql'

const subject = (
  characterId: number,
  coverage: PersonalInventorySubject['coverage'] = null,
): PersonalInventorySubject => ({
  characterId,
  characterName: `Character ${characterId}`,
  userId: 'owner',
  characterLifecycle: `life-${characterId}`,
  authorizationRevision: 7,
  pendingAttemptId: null,
  coverage,
  evidenceReadable: coverage === null,
})
const binding = (subjects: readonly PersonalInventorySubject[]): PersonalInventoryBinding => ({
  scope: 'personal',
  actorUserId: 'owner',
  selection: undefined,
  subjects,
  evidenceSubjects: subjects.filter((row) => row.evidenceReadable),
  fingerprint: 'authority',
})
const admission = (value: PersonalInventoryBinding): PlatformAdmittedPersonalInventory => {
  const evidence: Pick<
    PlatformAdmittedPersonalInventory,
    'scope' | 'actorUserId' | 'fingerprint' | 'subjects'
  > = {
    scope: 'personal',
    actorUserId: value.actorUserId,
    fingerprint: value.fingerprint,
    subjects: value.evidenceSubjects,
  }
  // SAFETY: These controlled subjects exercise the source boundary; production admission remains core-owned.
  return evidence as PlatformAdmittedPersonalInventory
}
const asset = (itemId: number, overrides: Partial<AssetSnapshot> = {}): AssetSnapshot => ({
  itemId,
  typeId: 34,
  quantity: 5,
  isSingleton: false,
  isBlueprintCopy: null,
  locationId: 60000001,
  locationType: 'station',
  parentItemId: null,
  locationFlag: 'Hangar',
  ...overrides,
})
const page = (assets: readonly AssetSnapshot[], pageNumber = 1, totalPages = 1) => ({
  authorizationGeneration: 7,
  data: { assets, page: pageNumber, totalPages },
  source: 'cache',
  quota: {},
  stale: false,
  validatedAt: '2026-10-03T10:00:00.000Z',
  cachedUntil: '2026-10-03T12:00:00.000Z',
  readableUntil: '2026-10-03T14:00:00.000Z',
})
const work = () => immediateAssetWork()
const emptyEnrichment = { types: new Map(), locations: new Map() }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime('2026-10-03T11:00:00.000Z')
  vi.resetAllMocks()
  for (const method of ['from', 'leftJoin', 'where'] as const)
    mocks.query[method].mockImplementation(() => mocks.query)
  mocks.query.limit.mockResolvedValue([])
  mocks.names.mockResolvedValue({ complete: true, names: new Map() })
  mocks.locations.mockResolvedValue([])
  mocks.execute.mockImplementation((_definition, input) =>
    page([asset(input.characterId)], input.page),
  )
})
afterEach(() => vi.useRealTimers())

describe('complete personal inventory sources and reduction', () => {
  test('aggregates all source pages across holders and filters after complete traversal without changing coverage', async () => {
    const bound = binding([subject(1), subject(2), subject(3, 'authorization-required')])
    mocks.execute.mockImplementation((_definition, input) => {
      if (input.characterId === 2) return page([asset(20, { quantity: 11 })])
      return page(
        [
          asset(input.page, {
            quantity: input.page === 1 ? 7 : 13,
            typeId: input.page === 1 ? 34 : 35,
          }),
        ],
        input.page,
        2,
      )
    })
    const sources = await readPersonalInventorySources(admission(bound), work())
    mocks.query.limit.mockResolvedValue([
      { typeId: 35, typeName: 'Mineral', groupId: 18, categoryId: 4 },
    ])
    const enriched = await enrichInventoryItems(
      sources.flatMap((source) => source.items),
      work(),
    )
    const result = reducePersonalInventory(bound, sources, enriched, { typeId: 35 })
    expect(result.groups.map((row) => [row.typeId, row.currentQuantity])).toEqual([[35, '13']])
    expect(result.coverage.map((row) => row.state)).toEqual([
      'included-current',
      'included-current',
      'authorization-required',
    ])
    expect(result.expectedSubjects).toBe(3)
    expect(result.sourcesComplete).toBe(false)
    const selected = [
      { groupId: 18 },
      { categoryId: 4 },
      { locationKey: 'station:60000001', typeId: 35 },
    ].map((filters) => reducePersonalInventory(bound, sources, enriched, filters))
    expect(selected.map((view) => view.groups.map((row) => row.currentQuantity))).toEqual([
      ['13'],
      ['13'],
      ['13'],
    ])
    expect(selected.every((view) => view.coverageCounts['authorization-required'] === 1)).toBe(true)
    expect(reducePersonalInventory(bound, sources, enriched, { groupId: 99 }).groups).toEqual([])
    expect(mocks.execute.mock.calls.map(([, input]) => [input.characterId, input.page])).toEqual([
      [1, 1],
      [1, 2],
      [2, 1],
    ])
    expect(
      mocks.execute.mock.calls.every(
        ([definition]) => definition.operation === 'character-assets-page',
      ),
    ).toBe(true)
    expect(mocks.query.limit).toHaveBeenCalledTimes(1)
    expect(mocks.locations).toHaveBeenCalledTimes(1)
  })

  test('keeps valid quantities when public enrichment fails', async () => {
    mocks.query.limit.mockRejectedValue(new Error('SDE unavailable'))
    mocks.names.mockRejectedValue(new Error('names unavailable'))
    mocks.locations.mockRejectedValue(new Error('locations unavailable'))
    const bound = binding([subject(1)])
    const sources = await readPersonalInventorySources(admission(bound), work())
    const enriched = await enrichInventoryItems(
      sources.flatMap((value) => value.items),
      work(),
    )
    const result = reducePersonalInventory(bound, sources, enriched)
    expect(result.groups[0]).toMatchObject({
      currentQuantity: '5',
      typeName: 'Unknown type 34',
      groupId: null,
      categoryId: null,
      location: { state: 'unknown' },
    })
    expect(result.sourcesComplete).toBe(true)
  })

  test('distinguishes complete-empty and unavailable sources without inventing a zero observation', async () => {
    const bound = binding([subject(1), subject(2)])
    mocks.execute.mockImplementation((_definition, input) => {
      if (input.characterId === 2) throw new Error('upstream unavailable')
      return page([])
    })
    const sources = await readPersonalInventorySources(admission(bound), work())
    const result = reducePersonalInventory(bound, sources, emptyEnrichment)
    expect(result.groups).toEqual([])
    expect(result.coverage[0]).toMatchObject({
      state: 'included-current',
      source: { observationId: expect.any(String) },
    })
    expect(result.coverage[1]).toMatchObject({ state: 'unavailable', source: null })
    expect(result.coverageCounts['included-current']).toBe(1)
    expect(result.sourcesComplete).toBe(false)
  })

  test.each(['changed-count', 'failed-page', 'conflicting-row', 'invalid-quantity'])(
    'excludes all quantities from an incomplete character: %s',
    async (failure) => {
      const bound = binding([subject(1), subject(2)])
      mocks.execute.mockImplementation((_definition, input) => {
        if (input.characterId === 2) return page([asset(20, { quantity: 19 })])
        if (input.page === 1) return page([asset(1, { quantity: 100 })], 1, 2)
        if (failure === 'failed-page') throw new Error('page unavailable')
        if (failure === 'changed-count') return page([asset(2)], 2, 3)
        if (failure === 'invalid-quantity') return page([asset(2, { quantity: 0 })], 2, 2)
        return page([asset(1, { quantity: 101 })], 2, 2)
      })
      const result = reducePersonalInventory(
        bound,
        await readPersonalInventorySources(admission(bound), work()),
        emptyEnrichment,
      )
      expect(result.groups.map((row) => row.currentQuantity)).toEqual(['19'])
      expect(result.coverage[0]?.state).toBe(
        failure === 'failed-page' ? 'unavailable' : 'incomplete',
      )
      expect(result.holders.map((row) => row.characterId)).toEqual([2])
    },
  )

  test('separates current and permitted outage-stale quantities and refuses unsupported stale policy', async () => {
    const bound = binding([subject(1), subject(2), subject(3)])
    mocks.execute.mockImplementation((_definition, input) => {
      const value = page([asset(input.characterId)])
      if (input.characterId === 1) return value
      return {
        ...value,
        stale: true,
        cachedUntil: '2026-10-03T10:30:00.000Z',
        refreshFailureClass: input.characterId === 2 ? 'esi-unavailable' : 'response-invalid',
      }
    })
    const result = reducePersonalInventory(
      bound,
      await readPersonalInventorySources(admission(bound), work()),
      emptyEnrichment,
    )
    expect(result.groups[0]).toMatchObject({ currentQuantity: '5', staleQuantity: '5' })
    expect(result.coverage.map((row) => row.state)).toEqual([
      'included-current',
      'included-stale',
      'unavailable',
    ])
  })

  test('reports expired retained evidence as a gap and fences expiry during later work', async () => {
    const bound = binding([subject(1), subject(2)])
    mocks.execute.mockImplementation((_definition, input) => ({
      ...page([asset(input.characterId)]),
      readableUntil:
        input.characterId === 2 ? '2026-10-03T10:30:00.000Z' : '2026-10-03T14:00:00.000Z',
    }))
    const sources = await readPersonalInventorySources(admission(bound), work())
    expect(sources[1]).toMatchObject({ state: 'beyond-retention', items: [], source: null })
    vi.setSystemTime('2026-10-03T12:00:00.000Z')
    expect(() => assertPersonalInventorySourceCurrent(sources)).toThrow(InventorySourceRestartError)
  })

  test('refuses token-generation changes instead of reducing a new authorization into the bound scope', async () => {
    mocks.execute.mockResolvedValue({ ...page([asset(1)]), authorizationGeneration: 8 })
    await expect(
      readPersonalInventorySources(admission(binding([subject(1)])), work()),
    ).rejects.toThrow(InventorySourceRestartError)
  })

  test.each([11, 21])(
    'refuses %s source pages rather than returning a partial total',
    async (pages) => {
      mocks.execute.mockResolvedValue(page([asset(1)], 1, pages))
      await expect(
        readPersonalInventorySources(admission(binding([subject(1)])), work()),
      ).rejects.toThrow(InventorySourceLimitError)
      expect(mocks.execute).toHaveBeenCalledTimes(1)
    },
  )

  test('enforces the combined 20-page budget before reading a partial extra source', async () => {
    mocks.execute.mockImplementation((_definition, input) =>
      page(
        [asset(input.characterId * 100 + input.page)],
        input.page,
        input.characterId === 3 ? 1 : 10,
      ),
    )
    await expect(
      readPersonalInventorySources(
        admission(binding([subject(1), subject(2), subject(3)])),
        work(),
      ),
    ).rejects.toThrow(InventorySourceLimitError)
    expect(mocks.execute.mock.calls.filter(([, input]) => input.characterId === 2)).toHaveLength(1)
  })

  test('cancellation and shared operation limits propagate without being converted to coverage', async () => {
    const controller = new AbortController()
    const canceled = new Error('canceled')
    mocks.execute.mockImplementation(() => {
      controller.abort(canceled)
      return page([asset(1)], 1, 2)
    })
    await expect(
      readPersonalInventorySources(
        admission(binding([subject(1)])),
        immediateAssetWork(controller.signal),
      ),
    ).rejects.toBe(canceled)
    expect(mocks.execute).toHaveBeenCalledTimes(1)
    const limit = new GraphQLError('limit', { extensions: { code: 'OPERATION_LIMIT' } })
    mocks.execute.mockRejectedValue(limit)
    await expect(
      readPersonalInventorySources(admission(binding([subject(1)])), work()),
    ).rejects.toBe(limit)
  })

  test('reads 20 ordinary single-page characters within the existing shared budget', async () => {
    const state = new GraphQLRequestState(new AbortController().signal)
    const shared = { signal: state.signal, run: state.run }
    const bound = binding(Array.from({ length: 20 }, (_, index) => subject(index + 1)))
    const sources = await readPersonalInventorySources(admission(bound), shared)
    const enriched = await enrichInventoryItems(
      sources.flatMap((source) => source.items),
      shared,
    )
    const result = reducePersonalInventory(bound, sources, enriched)
    expect(result.groups[0]?.currentQuantity).toBe('100')
    expect(result.coverageCounts['included-current']).toBe(20)
    expect(result.sourcesComplete).toBe(true)
    expect(mocks.execute).toHaveBeenCalledTimes(20)
  })

  test('keeps conflict coverage visible and unaffected holder quantities correct', async () => {
    const bound = binding([subject(1), subject(2)])
    mocks.execute.mockImplementation((_definition, input) =>
      page([
        asset(100, { quantity: 1000 }),
        asset(input.characterId, { quantity: input.characterId }),
      ]),
    )
    const sources = await readPersonalInventorySources(admission(bound), work())
    const result = reducePersonalInventory(bound, sources, emptyEnrichment)
    expect(result.groups[0]?.currentQuantity).toBe('3')
    expect(result.holders.map((row) => row.currentQuantity)).toEqual(['1', '2'])
    expect(result.coverageCounts['conflicting-source']).toBe(2)
    expect(result.sourcesComplete).toBe(false)
  })

  test('batches enrichment and preserves blueprint distinctions and unknown locations', async () => {
    const bound = binding([subject(1)])
    mocks.execute.mockResolvedValue(
      page([
        asset(1, { typeId: 100, isBlueprintCopy: true }),
        asset(2, { typeId: 100, isBlueprintCopy: false }),
        asset(3, { typeId: 101, locationType: 'item', locationId: 99, parentItemId: 99 }),
        asset(4, { locationType: 'other', locationId: 1000000000001 }),
      ]),
    )
    mocks.query.limit.mockResolvedValue([
      { typeId: 100, typeName: 'Blueprint', groupId: 1, categoryId: 9 },
    ])
    mocks.names.mockResolvedValue({
      complete: true,
      names: new Map([[60000001, { category: 'station', name: 'Station' }]]),
    })
    const sources = await readPersonalInventorySources(admission(bound), work())
    const enriched = await enrichInventoryItems(
      sources.flatMap((source) => source.items),
      work(),
    )
    const result = reducePersonalInventory(bound, sources, enriched)
    expect(result.groups.filter((row) => row.typeId === 100).map((row) => row.blueprint)).toEqual([
      'copy',
      'original',
    ])
    expect(result.groups.find((row) => row.typeId === 101)).toMatchObject({
      typeName: 'Unknown type 101',
      location: { state: 'unresolved' },
      currentQuantity: '5',
    })
    expect(result.groups.find((row) => row.typeId === 34)?.location.state).toBe('restricted')
    expect(mocks.names.mock.calls[0]?.[0]).toEqual([60000001])
    expect(result.groups.find((row) => row.typeId === 100)?.location.state).toBe('resolved')
  })
})
