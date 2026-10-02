import {
  MARKET_CATALOGUE_GROUP_PAGE_SIZE,
  MARKET_CATALOGUE_MAX_GROUPS,
  MARKET_CATALOGUE_MAX_TYPES,
  type MarketCatalogueRequest,
  type MarketCatalogueResult,
} from '@eve-space/core-data-contract'
import { expect, test, vi } from 'vitest'
import { loadMarketCatalogueProduct } from '../../src/core-data/market-catalogue-adapter.js'

interface CatalogueRows {
  readonly revision?: typeof revision | null
  readonly groups?: readonly MarketGroupRow[]
  readonly counts?: readonly { market_group_id: string; direct_type_count: string }[]
  readonly group?: readonly { market_group_id: string }[]
  readonly types?: readonly MarketTypeRow[]
  readonly searchTypes?: readonly MarketJoinedTypeRow[]
  readonly selectedType?: readonly MarketJoinedTypeRow[]
}

interface MarketGroupRow {
  market_group_id: string
  parent_group_id: string | null
  name: string
  icon_id: string | null
}

interface MarketTypeRow {
  type_id: string
  market_group_id: string
  name: string
}

interface MarketJoinedTypeRow extends MarketTypeRow {
  group_exists?: boolean
}

const revision = {
  build_number: '3542233',
  ingest_version: 5,
  ingested_at: '2026-09-24T12:00:00Z',
}
const groups: readonly MarketGroupRow[] = [
  { market_group_id: '19', parent_group_id: null, name: 'Trade Goods', icon_id: null },
  { market_group_id: '614', parent_group_id: '19', name: 'Evidence', icon_id: '2302' },
]
const types: readonly MarketTypeRow[] = [
  { type_id: '34', market_group_id: '614', name: 'Tritanium' },
]

const catalogueDatabase = (rows: CatalogueRows = {}) => {
  const transaction = Object.assign(
    vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join(' ')
      if (query.includes('from sde_projection_state')) {
        return cancellable(rows.revision === null ? [] : [rows.revision ?? revision])
      }
      if (query.includes('from sde_market_groups as groups')) {
        return cancellable(rows.groups ?? groups)
      }
      if (query.includes('count(*)::text as direct_type_count')) {
        return cancellable(rows.counts ?? [{ market_group_id: '614', direct_type_count: '1' }])
      }
      if (query.includes('from sde_market_groups where')) {
        return cancellable(rows.group ?? [{ market_group_id: '614' }])
      }
      if (query.includes('where types.type_id =')) {
        return cancellable(rows.selectedType ?? [{ ...types[0]!, group_exists: true }])
      }
      if (query.includes('left join sde_market_groups')) {
        return cancellable(rows.searchTypes ?? [{ ...types[0]!, group_exists: true }])
      }
      return cancellable(rows.types ?? types)
    }),
    { unsafe: vi.fn(() => cancellable([])) },
  )
  return {
    begin: vi.fn(
      (_options: string, load: (value: typeof transaction) => Promise<MarketCatalogueResult>) =>
        load(transaction),
    ),
    transaction,
  }
}

const cancellable = <Value>(value: Value) =>
  Object.assign(Promise.resolve(value), { cancel: vi.fn() })

const loadWithDatabase = (
  request: MarketCatalogueRequest,
  database: ReturnType<typeof catalogueDatabase>,
) => {
  // SAFETY: The fake database provides the transaction and cancellable query methods used by this adapter.
  return loadMarketCatalogueProduct(request, database as never)
}

const load = (request: MarketCatalogueRequest, rows: CatalogueRows = {}) =>
  loadWithDatabase(request, catalogueDatabase(rows))

test('projects a complete hierarchy and independently addressable published types', async () => {
  const database = catalogueDatabase()
  const tree = await loadWithDatabase({ kind: 'tree' }, database)
  expect(tree).toMatchObject({
    complete: true,
    revision: { buildNumber: 3542233, ingestVersion: 5 },
    groups: [
      { id: 19, parentId: null, iconId: null, directTypeCount: 0 },
      { id: 614, parentId: 19, iconId: 2302, directTypeCount: 1 },
    ],
  })
  expect(database.begin).toHaveBeenCalledWith(
    'ISOLATION LEVEL REPEATABLE READ READ ONLY',
    expect.any(Function),
  )
  expect(database.transaction).toHaveBeenCalledWith(
    expect.arrayContaining([expect.stringContaining('lock table sde_projection_state')]),
  )
  await expect(load({ kind: 'type-by-id', typeId: 34 })).resolves.toMatchObject({
    item: { id: 34, groupId: 614, name: 'Tritanium' },
  })
  await expect(
    load({ kind: 'type-by-id', typeId: 35 }, { selectedType: [] }),
  ).resolves.toMatchObject({
    item: null,
  })
  await expect(load({ kind: 'search-index' })).resolves.toMatchObject({
    types: [{ id: 34, groupId: 614 }],
  })
})

test('rejects malformed requests before opening a transaction', () => {
  const database = catalogueDatabase()
  const invalidRequests: readonly (readonly [MarketCatalogueRequest, string])[] = [
    [{ kind: 'type-by-id', typeId: 0 }, 'Invalid market type ID'],
    [{ kind: 'group-types', groupId: -1 }, 'Invalid market group ID'],
    [{ kind: 'group-types', groupId: 614, cursor: 't_!' }, 'Invalid market group cursor'],
    [{ kind: 'group-types', groupId: 614, cursor: 't_0' }, 'Invalid market group cursor'],
  ]
  for (const [request, message] of invalidRequests) {
    expect(() => loadWithDatabase(request, database)).toThrow(message)
  }
  expect(database.begin).not.toHaveBeenCalled()
})

test('paginates a published group without reissuing its first page', async () => {
  const pageTypes = Array.from({ length: MARKET_CATALOGUE_GROUP_PAGE_SIZE + 1 }, (_, index) => ({
    type_id: String(index + 1),
    market_group_id: '614',
    name: `Type ${index + 1}`,
  }))
  const first = await load({ kind: 'group-types', groupId: 614 }, { types: pageTypes })
  expect(first).toMatchObject({
    groupId: 614,
    items: expect.arrayContaining([{ id: 100, groupId: 614, name: 'Type 100' }]),
    nextCursor: 't_2s',
  })
  if (first.kind !== 'group-types') throw new Error('Expected a group page')
  expect(first.items).toHaveLength(MARKET_CATALOGUE_GROUP_PAGE_SIZE)
  const next = catalogueDatabase({
    types: [{ type_id: '101', market_group_id: '614', name: 'Type 101' }],
  })
  await expect(
    loadWithDatabase({ kind: 'group-types', groupId: 614, cursor: first.nextCursor! }, next),
  ).resolves.toMatchObject({ items: [{ id: 101 }], nextCursor: null })
  expect(next.transaction).toHaveBeenCalledWith(
    expect.arrayContaining([expect.stringContaining('types.type_id > '), expect.any(String)]),
    614,
    100,
    MARKET_CATALOGUE_GROUP_PAGE_SIZE + 1,
  )
})

test('rejects inconsistent revisions and incomplete market groups', async () => {
  await expect(load({ kind: 'tree' }, { revision: null })).rejects.toThrow('revision is missing')
  await expect(
    load({ kind: 'tree' }, { revision: { ...revision, ingest_version: 4 } }),
  ).rejects.toThrow('projection is not published')
  await expect(load({ kind: 'tree' }, { groups: [] })).rejects.toThrow('group bound')
  await expect(
    load(
      { kind: 'tree' },
      { groups: Array.from({ length: MARKET_CATALOGUE_MAX_GROUPS + 1 }, () => groups[0]!) },
    ),
  ).rejects.toThrow('group bound')
  await expect(
    load({ kind: 'tree' }, { groups: [{ ...groups[1]!, parent_group_id: '999' }] }),
  ).rejects.toThrow('missing parent')
  await expect(
    load({ kind: 'tree' }, { groups: [{ ...groups[1]!, parent_group_id: '614' }] }),
  ).rejects.toThrow('parent cycle')
  await expect(
    load({ kind: 'tree' }, { counts: [{ market_group_id: '999', direct_type_count: '1' }] }),
  ).rejects.toThrow('missing group')
  await expect(
    load(
      { kind: 'tree' },
      {
        counts: [
          { market_group_id: '614', direct_type_count: String(MARKET_CATALOGUE_MAX_TYPES + 1) },
        ],
      },
    ),
  ).rejects.toThrow('type bound')
})

test('refuses orphaned or over-bound type results instead of publishing partial search data', async () => {
  await expect(
    load(
      { kind: 'type-by-id', typeId: 34 },
      { selectedType: [{ ...types[0]!, group_exists: false }] },
    ),
  ).rejects.toThrow('missing group')
  await expect(
    load({ kind: 'search-index' }, { searchTypes: [{ ...types[0]!, group_exists: false }] }),
  ).rejects.toThrow('missing group')
  await expect(
    load(
      { kind: 'search-index' },
      { searchTypes: Array.from({ length: MARKET_CATALOGUE_MAX_TYPES + 1 }, () => types[0]!) },
    ),
  ).rejects.toThrow('type bound')
  await expect(load({ kind: 'group-types', groupId: 614 }, { group: [] })).rejects.toThrow(
    'Market group is missing',
  )
})

test('owns short-page continuation and uses the requested database limit', async () => {
  const first = catalogueDatabase({
    types: [
      { type_id: '34', market_group_id: '614', name: 'Tritanium' },
      { type_id: '35', market_group_id: '614', name: 'Pyerite' },
    ],
  })
  const result = await loadWithDatabase({ kind: 'group-types', groupId: 614, pageSize: 1 }, first)
  expect(result).toMatchObject({ items: [{ id: 34 }], nextCursor: 't_y' })
  if (result.kind !== 'group-types') throw new Error('Expected a group page')
  expect(result.items).toHaveLength(1)
  expect(first.transaction).toHaveBeenCalledWith(
    expect.arrayContaining([expect.stringContaining('types.type_id > '), expect.any(String)]),
    614,
    0,
    2,
  )
  const next = catalogueDatabase({
    types: [{ type_id: '35', market_group_id: '614', name: 'Pyerite' }],
  })
  await expect(
    loadWithDatabase(
      { kind: 'group-types', groupId: 614, cursor: result.nextCursor!, pageSize: 1 },
      next,
    ),
  ).resolves.toMatchObject({ items: [{ id: 35 }], nextCursor: null })
  expect(next.transaction).toHaveBeenCalledWith(
    expect.arrayContaining([expect.stringContaining('types.type_id > '), expect.any(String)]),
    614,
    34,
    2,
  )
})

test.each([0, -1, 101, 1.5, Number.NaN])(
  'rejects page size %s before opening a transaction',
  (pageSize) => {
    const database = catalogueDatabase()
    expect(() =>
      loadWithDatabase({ kind: 'group-types', groupId: 614, pageSize }, database),
    ).toThrow('Invalid market group page size')
    expect(database.begin).not.toHaveBeenCalled()
  },
)

test('rejects a canceled caller before opening a catalogue transaction', () => {
  const database = catalogueDatabase()
  const signal = AbortSignal.abort(new Error('Caller canceled'))
  expect(() => loadWithDatabase({ kind: 'revision', signal }, database)).toThrow('Caller canceled')
  expect(database.begin).not.toHaveBeenCalled()
})

test('cancels a catalogue SQL query without admitting another query', async () => {
  const { createDeferred } = await import('../support/deferred.js')
  const pending = createDeferred<never[]>()
  const canceled = new Error('Caller disconnected')
  const cancel = vi.fn(() => pending.reject(canceled))
  const query = Object.assign(pending.promise, { cancel })
  const database = catalogueDatabase()
  database.transaction.mockImplementation(() => query)
  const controller = new AbortController()
  const read = loadWithDatabase({ kind: 'revision', signal: controller.signal }, database)
  const result = read.catch((error: Error) => error)
  await vi.waitFor(() => expect(database.transaction).toHaveBeenCalledOnce())
  controller.abort(canceled)
  expect(await result).toBe(canceled)
  expect(cancel).toHaveBeenCalledOnce()
  expect(database.transaction).toHaveBeenCalledOnce()
})
