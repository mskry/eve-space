import { randomUUID } from 'node:crypto'
import {
  normalizeInventoryObservation,
  excludeInventoryConflicts,
} from '@eve-space/core-eve-projections/asset-inventory'
import {
  projectAsset,
  projectAssetSnapshot,
  type ProjectedAsset,
} from '@eve-space/core-eve-projections/assets'
import { memberAssetInventoryProvider } from '@eve-space/member-audit-server'
import type {
  PlatformAdmittedCorporationInventory,
  PlatformCorporationInventorySubject,
} from '@eve-space/platform-module-contract/inventory'
import { bindPlatformPersistenceOperation } from '@eve-space/platform-module-server'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { createStandaloneModulePersistenceOperationInvoker } from '../../../src/db/module-persistence-operation-transaction.js'
import { runStartupMigrations } from '../../../src/db/startup-migrations.js'
import {
  installedModulePersistenceOperationCatalog as catalog,
  installedModulePersistenceOperations,
} from '../../../src/generated/platform/installed-module-persistence.js'

let container: StartedTestContainer
let connection: postgres.Sql
const authority = {
  organizationVersion: 1,
  targetUserId: '71111111-1111-4111-8111-111111111111',
  managedMemberLifecycleId: '72222222-2222-4222-8222-222222222222',
  characterId: 90_000_101,
  characterLifecycleId: '73333333-3333-4333-8333-333333333333',
  authorizationGeneration: 1,
  disclosureVersion: 1,
  sectionActivationVersion: 1,
}
const validatedAt = new Date().toISOString()
const operation = <Key extends keyof typeof catalog>(key: Key, readOnly = false) =>
  bindPlatformPersistenceOperation(
    catalog[key],
    createStandaloneModulePersistenceOperationInvoker(
      connection,
      'member-audit',
      installedModulePersistenceOperations,
      { readOnly, statementTimeoutMilliseconds: 2000 },
    ),
  )
const readers = () => ({
  readInventorySources: operation('member-audit/read-inventory-sources', true),
  readAssetInventory: operation('member-audit/read-asset-inventory', true),
})
const asset = (itemId: number, values: Partial<ProjectedAsset> = {}): ProjectedAsset => ({
  ...projectAsset(
    projectAssetSnapshot({
      item_id: itemId,
      type_id: 34,
      quantity: 3,
      is_singleton: false,
      location_id: 60_000_001,
      location_type: 'station',
      location_flag: 'Hangar',
    }),
    {
      typeName: 'Tritanium',
      groupId: 18,
      groupName: 'Mineral',
      categoryId: 4,
      categoryName: 'Material',
      unitVolume: 0.01,
    },
    undefined,
    { name: 'Station', solarSystemId: 30_000_001, solarSystemSecurityStatus: null },
  ),
  ...values,
})
const stage = async (
  subject: typeof authority,
  records: readonly ProjectedAsset[],
  complete = true,
  clock = validatedAt,
) => {
  const identity = {
    ...subject,
    sectionId: 'assets' as const,
    resourceId: 'assets' as const,
    observationId: randomUUID(),
    operationContractRevision: 1,
    resourceRevision: 1,
  }
  const staged = await operation('member-audit/write-evidence-continuation')({
    ...identity,
    expectedRevision: 0,
    checkpoint: { complete },
    updatedAt: clock,
    records: records.map((evidence) => ({
      recordKind: 'asset' as const,
      sourceId: String(evidence.itemId),
      sourceTimestamp: null,
      evidence: { ...evidence },
      validatedAt: clock,
    })),
  })
  if (staged.outcome !== 'applied') throw new Error('Fixture staging was obsolete')
  return {
    ...identity,
    dtoRevision: 1 as const,
    expectedRevision: staged.revision,
    validatedAt: clock,
  }
}
const promote = async (
  subject: typeof authority,
  records: readonly ProjectedAsset[],
  clock = validatedAt,
) => {
  const input = await stage(subject, records, true, clock)
  expect(await operation('member-audit/promote-asset-inventory')(input)).toEqual({
    outcome: 'applied',
  })
  return { ...subject, observationId: input.observationId }
}
const groups = (
  subjects: Parameters<ReturnType<typeof readers>['readAssetInventory']>[0]['subjects'],
  extra: Partial<Parameters<ReturnType<typeof readers>['readAssetInventory']>[0]> = {},
) =>
  readers().readAssetInventory({
    subjects,
    kind: 'groups',
    first: 100,
    after: null,
    groupKey: null,
    filters: {},
    ...extra,
  })
const seedLegacy = async (subject: typeof authority, records: readonly ProjectedAsset[]) => {
  const observationId = randomUUID()
  await connection`insert into eve_module_member_audit.asset_snapshots (organization_version, target_user_id, managed_member_lifecycle_id, character_id, character_lifecycle_id, authorization_generation, disclosure_version, section_activation_version, dto_revision, observation_id, snapshot, validated_at) values (${subject.organizationVersion}, ${subject.targetUserId}, ${subject.managedMemberLifecycleId}, ${subject.characterId}, ${subject.characterLifecycleId}, ${subject.authorizationGeneration}, ${subject.disclosureVersion}, ${subject.sectionActivationVersion}, 1, ${observationId}, ${connection.json({ kind: 'assets', records: records.map((row) => ({ ...row })) })}, ${validatedAt})`
  return { ...subject, observationId }
}
// SAFETY: This synthetic capability binds controlled fixture subjects to the provider under test.
const admitted = (
  subjects: readonly PlatformCorporationInventorySubject[],
): PlatformAdmittedCorporationInventory =>
  ({
    scope: 'corporation',
    actorUserId: randomUUID(),
    corporationId: 98_000_001,
    organizationVersion: 1,
    authorizationRevision: 1,
    fingerprint: 'core-bound-test',
    subjects,
  }) as PlatformAdmittedCorporationInventory
const subjectFor = (
  tuple: typeof authority & { observationId: string },
  state: 'current' | 'stale' = 'current',
): PlatformCorporationInventorySubject => ({
  characterId: tuple.characterId,
  userId: tuple.targetUserId,
  characterLifecycle: tuple.characterLifecycleId,
  authorizationRevision: tuple.authorizationGeneration,
  authorizationGeneration: tuple.authorizationGeneration,
  evidenceReadable: true,
  corporationId: 98_000_001,
  memberLifecycle: tuple.managedMemberLifecycleId,
  disclosureRevision: tuple.disclosureVersion,
  sectionActivationRevision: tuple.sectionActivationVersion,
  observationId: null,
  characterName: `Pilot ${tuple.characterId}`,
  collection: {
    state,
    validatedAt,
    freshUntil: new Date(Date.parse(validatedAt) + 3_600_000).toISOString(),
    lastFailureClass: null,
  },
})

const inventoryQueryPlan = (
  input: Parameters<ReturnType<typeof readers>['readAssetInventory']>[0],
) =>
  connection.begin(async (transaction) => {
    await transaction`set local search_path = eve_module_member_audit, pg_catalog`
    await transaction`set local statement_timeout = '2s'`
    const [routine] = await transaction<{ definition: string }[]>`
      select pg_get_functiondef('eve_module_member_audit.persist_read_asset_inventory(jsonb)'::regprocedure) as definition
    `
    const definition = routine!.definition
    const body = definition.slice(
      definition.indexOf('BEGIN ATOMIC') + 12,
      definition.lastIndexOf('END'),
    )
    const query = body
      .replaceAll('persist_read_asset_inventory.input', 'input')
      .replaceAll(/\binput\b/g, '($1::jsonb)')
    const parameters = [transaction.json(input)]
    const [result] = await transaction.unsafe<
      {
        jsonb_build_object: Awaited<ReturnType<ReturnType<typeof readers>['readAssetInventory']>>
      }[]
    >(query, parameters)
    expect(result!.jsonb_build_object.groups).toHaveLength(10)
    return transaction.unsafe(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`, parameters)
  })

beforeAll(async () => {
  const password = randomUUID()
  container = await new GenericContainer('postgres:17-alpine')
    .withEnvironment({
      POSTGRES_DB: 'eve_space',
      POSTGRES_PASSWORD: password,
      POSTGRES_USER: 'eve_space',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start()
  const environment = container.getHost()
  connection = postgres(
    `postgres://eve_space:${password}@${environment}:${container.getMappedPort(5432)}/eve_space`,
  )
  await runStartupMigrations(connection)
})
afterAll(async () => {
  await connection?.end()
  await container?.stop()
})

test('attests exactly four routines and confines runtime reads and writes', async () => {
  const declared = installedModulePersistenceOperations.filter(
    ({ moduleId, migration }) =>
      moduleId === 'member-audit' && migration === 'member-audit-003-asset-inventory.sql',
  )
  expect(
    declared.map(({ operationId }) => operationId).toSorted((a, b) => a.localeCompare(b)),
  ).toEqual([
    'backfill-asset-inventory',
    'promote-asset-inventory',
    'read-asset-inventory',
    'read-inventory-sources',
  ])
  for (const entry of declared.filter(({ mode }) => mode === 'read'))
    expect('inventoryProviders' in entry.grants && entry.grants.inventoryProviders).toEqual([
      'assets-inventory',
    ])
  await expect(
    connection.begin(async (transaction) => {
      await transaction`set local role eve_module_member_audit_runtime`
      await transaction`select * from public.characters`
    }),
  ).rejects.toMatchObject({ code: '42501' })
  await expect(
    connection.begin(async (transaction) => {
      await transaction`set local role eve_module_member_audit_runtime`
      await transaction`insert into eve_module_member_audit.asset_inventory_observations(character_id, observation_id, validated_at, ready) values (1, ${randomUUID()}, now(), true)`
    }),
  ).rejects.toMatchObject({ code: '42501' })
})

test('serves a 250-character projection with bounded set reads, pagination and statement timeout', async () => {
  const tuples = []
  for (let index = 0; index < 250; index += 1) {
    const current = {
      ...authority,
      characterId: 91_000_000 + index,
      characterLifecycleId: randomUUID(),
      targetUserId: randomUUID(),
      managedMemberLifecycleId: randomUUID(),
    }
    tuples.push(
      await promote(
        current,
        Array.from({ length: 100 }, (_, row) =>
          asset(91_000_000 + index * 1000 + row, { typeId: 34 + (row % 10) }),
        ),
      ),
    )
  }
  await connection`analyze eve_module_member_audit.asset_snapshots`
  await connection`analyze eve_module_member_audit.asset_inventory_observations`
  await connection`analyze eve_module_member_audit.asset_inventory_items`
  const persistence = {
    readInventorySources: vi.fn(readers().readInventorySources),
    readAssetInventory: vi.fn(readers().readAssetInventory),
  }
  const provider = memberAssetInventoryProvider({
    persistence,
    signal: new AbortController().signal,
  })
  const scope = admitted(tuples.map((tuple) => subjectFor(tuple)))
  const before = process.memoryUsage()
  const started = performance.now()
  const result = await provider(scope, { kind: 'groups', first: 100 })
  const durationMilliseconds = performance.now() - started
  expect(result).toMatchObject({ expectedSubjects: 250, sourcesComplete: true })
  expect(result.coverageCounts['included-current']).toBe(250)
  expect(result.groups.rows).toHaveLength(10)
  expect(result.groups.rows.map((row) => row.currentQuantity)).toEqual(Array(10).fill('7500'))
  expect(persistence.readInventorySources).toHaveBeenCalledTimes(2)
  expect(persistence.readAssetInventory).toHaveBeenCalledTimes(1)
  const plan = await inventoryQueryPlan(persistence.readAssetInventory.mock.calls[0]![0])
  console.info(
    'Trading corporation capacity',
    JSON.stringify({
      subjects: 250,
      projectedRows: 25_000,
      persistenceCalls: 3,
      durationMilliseconds,
      responseBytes: Buffer.byteLength(JSON.stringify(result)),
      heapDeltaBytes: process.memoryUsage().heapUsed - before.heapUsed,
      rssDeltaBytes: process.memoryUsage().rss - before.rss,
      processPeakRssKiB: process.resourceUsage().maxRSS,
      queryPlan: plan,
    }),
  )
  const holders = await provider(scope, {
    kind: 'holders',
    first: 100,
    groupKey: result.groups.rows[0]!.key,
  })
  const next = await provider(scope, {
    kind: 'holders',
    first: 100,
    groupKey: result.groups.rows[0]!.key,
    after: holders.holders.endCursor!,
  })
  expect(holders.holders.rows).toHaveLength(100)
  expect(next.holders.rows).toHaveLength(100)
  expect(next.holders.rows[0]!.characterId).toBeGreaterThan(
    holders.holders.rows.at(-1)!.characterId,
  )
  await expect(
    provider(admitted([...scope.subjects, { ...scope.subjects[0]!, characterId: 92_000_000 }]), {
      kind: 'groups',
      first: 100,
    }),
  ).rejects.toThrow('Inventory read exceeds its declared scope')

  const locker = await connection.reserve()
  await locker`begin`
  await locker`lock table eve_module_member_audit.asset_inventory_items in access exclusive mode`
  const blockedAt = performance.now()
  try {
    await expect(
      groups(tuples.map((tuple) => Object.assign({}, tuple, { stale: false }))),
    ).rejects.toMatchObject({ category: 'execution', operationId: 'read-asset-inventory' })
  } finally {
    await locker`rollback`
    locker.release()
  }
  const refusedAfterMilliseconds = performance.now() - blockedAt
  expect(refusedAfterMilliseconds).toBeGreaterThan(1500)
  expect(refusedAfterMilliseconds).toBeLessThan(4000)
  console.info(
    'Trading corporation statement timeout',
    JSON.stringify({ refusedAfterMilliseconds, statementTimeoutMilliseconds: 2000 }),
  )
})

test('publishes only complete observations and distinguishes legacy gaps from complete empty', async () => {
  const subject = { ...authority, characterId: 90_000_201, characterLifecycleId: randomUUID() }
  const input = await stage(subject, [asset(1)], false)
  expect(await operation('member-audit/promote-asset-inventory')(input)).toEqual({
    outcome: 'obsolete',
  })
  expect(
    await readers().readInventorySources({ subjects: [{ ...subject, observationId: null }] }),
  ).toEqual([
    { characterId: subject.characterId, observationId: null, validatedAt: null, ready: false },
  ])
  const empty = await promote(
    { ...authority, characterId: 90_000_202, characterLifecycleId: randomUUID() },
    [],
  )
  expect(await readers().readInventorySources({ subjects: [empty] })).toMatchObject([
    { ready: true, observationId: empty.observationId },
  ])
  expect((await groups([{ ...empty, stale: false }])).groups).toEqual([])
  const legacy = await seedLegacy(
    { ...authority, characterId: 90_000_203, characterLifecycleId: randomUUID() },
    [asset(2)],
  )
  const provider = memberAssetInventoryProvider({
    persistence: readers(),
    signal: new AbortController().signal,
  })
  const gap = await provider(admitted([subjectFor(legacy)]), { kind: 'coverage', first: 100 })
  expect(gap.coverage.rows[0]?.state).toBe('incomplete')
  expect(gap.sourcesComplete).toBe(false)
  expect(await operation('member-audit/backfill-asset-inventory')({ subjects: [legacy] })).toEqual({
    projected: 1,
  })
  const ready = await provider(admitted([subjectFor(legacy), subjectFor(empty)]), {
    kind: 'coverage',
    first: 100,
  })
  expect(ready.sourcesComplete).toBe(true)
  expect(ready.coverageCounts['included-current']).toBe(2)
  await expect(
    operation('member-audit/backfill-asset-inventory')({
      subjects: Array.from({ length: 21 }, (_, i) => ({
        ...legacy,
        characterId: legacy.characterId + i,
      })),
    }),
  ).rejects.toThrow(/Module persistence operation/)
})

test('rejects each authority mismatch and pinned observation mismatch, including backfill', async () => {
  const tuple = await promote(
    { ...authority, characterId: 90_000_204, characterLifecycleId: randomUUID() },
    [asset(3)],
  )
  const mutations = [
    { organizationVersion: 2 },
    { targetUserId: randomUUID() },
    { managedMemberLifecycleId: randomUUID() },
    { characterId: 90_000_205 },
    { characterLifecycleId: randomUUID() },
    { authorizationGeneration: 2 },
    { disclosureVersion: 2 },
    { sectionActivationVersion: 2 },
    { observationId: randomUUID() },
  ]
  for (const mutation of mutations) {
    const wrong = { ...tuple, ...mutation }
    expect(await readers().readInventorySources({ subjects: [wrong] })).toMatchObject([
      { ready: false, observationId: null },
    ])
    expect((await groups([{ ...wrong, stale: false }])).groups).toEqual([])
    expect(await operation('member-audit/backfill-asset-inventory')({ subjects: [wrong] })).toEqual(
      { projected: 0 },
    )
  }
  expect((await groups([{ ...tuple, stale: false }])).groups[0]?.currentQuantity).toBe('3')
})

test('rolls back source promotion, derived rows and continuation cleanup on a projection failure', async () => {
  const subject = { ...authority, characterId: 90_000_206, characterLifecycleId: randomUUID() }
  const previous = await promote(subject, [asset(4)])
  const replacement = await stage(
    subject,
    [asset(5, { quantity: 7 })],
    true,
    new Date(Date.parse(validatedAt) + 1000).toISOString(),
  )
  await connection`alter table eve_module_member_audit.asset_inventory_items add constraint fixture_projection_failure check (quantity <> 7)`
  try {
    await expect(operation('member-audit/promote-asset-inventory')(replacement)).rejects.toThrow(
      /Module persistence operation/,
    )
  } finally {
    await connection`alter table eve_module_member_audit.asset_inventory_items drop constraint fixture_projection_failure`
  }
  expect(await readers().readInventorySources({ subjects: [previous] })).toMatchObject([
    { ready: true, observationId: previous.observationId },
  ])
  expect((await groups([{ ...previous, stale: false }])).groups[0]?.currentQuantity).toBe('3')
  const [continuation] =
    await connection`select revision from eve_module_member_audit.collection_continuations where observation_id = ${replacement.observationId}`
  expect(continuation).toBeDefined()
  expect(await operation('member-audit/promote-asset-inventory')(replacement)).toEqual({
    outcome: 'applied',
  })
  expect((await groups([{ ...previous, stale: false }])).groups).toEqual([])
  expect(
    (await groups([{ ...subject, observationId: replacement.observationId, stale: false }]))
      .groups[0]?.currentQuantity,
  ).toBe('7')
})

test('matches pure roots, deduplication and exact sums; excludes cross-holder conflicts before filters', async () => {
  const records = [
    asset(10, { quantity: Number.MAX_SAFE_INTEGER }),
    asset(11, {
      quantity: Number.MAX_SAFE_INTEGER,
      parentItemId: 10,
      locationId: 10,
      locationType: 'item',
      locationName: null,
    }),
    asset(12, { parentItemId: 999, locationId: 999, locationType: 'item', locationName: null }),
    asset(13, { parentItemId: 14, locationId: 14, locationType: 'item', locationName: null }),
    asset(14, { parentItemId: 13, locationId: 13, locationType: 'item', locationName: null }),
    asset(15, { locationType: 'other', locationId: 1_000_000_001, locationName: null }),
    asset(16, { typeId: 100, categoryId: 9, typeName: 'Blueprint' }),
    asset(17, { typeId: 100, categoryId: 9, typeName: 'Blueprint', isBlueprintCopy: true }),
  ]
  const left = await seedLegacy(
    { ...authority, characterId: 90_000_207, characterLifecycleId: randomUUID() },
    [...records, { ...records[0]!, customName: 'Ignored private name' }],
  )
  const rightRecords = [asset(10), asset(18)]
  const right = await promote(
    { ...authority, characterId: 90_000_208, characterLifecycleId: randomUUID() },
    rightRecords,
  )
  expect(await operation('member-audit/backfill-asset-inventory')({ subjects: [left] })).toEqual({
    projected: 1,
  })
  const normalized = normalizeInventoryObservation(records)
  const projected = await connection<
    { item_id: string; location_key: string; quantity: string }[]
  >`select item_id::text, location_key, quantity::text from eve_module_member_audit.asset_inventory_items where character_id = ${left.characterId} order by item_id`
  expect(projected.map((row) => [row.item_id, row.location_key, row.quantity])).toEqual(
    normalized.map((row) => [String(row.itemId), row.root.key, row.quantity]),
  )
  const solo = await groups([{ ...left, stale: false }])
  expect(
    solo.groups.find(({ typeId, location }) => typeId === 34 && location.key === 'station:60000001')
      ?.currentQuantity,
  ).toBe((BigInt(Number.MAX_SAFE_INTEGER) * 2n).toString())
  const provider = memberAssetInventoryProvider({
    persistence: readers(),
    signal: new AbortController().signal,
  })
  const binding = admitted([subjectFor(left), subjectFor(right, 'stale')])
  const result = await provider(binding, { kind: 'groups', first: 100 })
  const clean = excludeInventoryConflicts([
    { characterId: left.characterId, items: normalized },
    { characterId: right.characterId, items: normalizeInventoryObservation(rightRecords) },
  ])
  expect(result.coverageCounts['conflicting-source']).toBe(clean.conflictingCharacters.size)
  expect(result.sourcesComplete).toBe(false)
  const mineral = result.groups.rows.find(
    ({ typeId, location }) => typeId === 34 && location.key === 'station:60000001',
  )!
  expect(mineral).toMatchObject({
    currentQuantity: String(Number.MAX_SAFE_INTEGER),
    staleQuantity: '3',
  })
  expect(
    result.groups.rows
      .filter(({ typeId }) => typeId === 100)
      .map(({ blueprint }) => blueprint)
      .toSorted((a, b) => a.localeCompare(b)),
  ).toEqual(['copy', 'original'])
  const filtered = await provider(binding, { kind: 'groups', first: 100, filters: { typeId: 100 } })
  expect(filtered.coverageCounts).toEqual(result.coverageCounts)
  expect(filtered.groups.rows.every(({ typeId }) => typeId === 100)).toBe(true)
  const holders = await provider(binding, { kind: 'holders', groupKey: mineral.key, first: 1 })
  expect(holders.holders).toMatchObject({
    hasNextPage: true,
    rows: [
      {
        characterId: left.characterId,
        currentQuantity: String(Number.MAX_SAFE_INTEGER),
        staleQuantity: '0',
      },
    ],
  })
  const next = await provider(binding, {
    kind: 'holders',
    groupKey: mineral.key,
    first: 1,
    after: holders.holders.endCursor!,
  })
  expect(next.holders).toMatchObject({
    hasNextPage: false,
    rows: [{ characterId: right.characterId, currentQuantity: '0', staleQuantity: '3' }],
  })
  const page = await provider(binding, { kind: 'groups', first: 2 })
  const page2 = await provider(binding, {
    kind: 'groups',
    first: 100,
    after: page.groups.endCursor!,
  })
  expect([...page.groups.rows, ...page2.groups.rows]).toEqual(result.groups.rows)
  await expect(
    provider(binding, { kind: 'groups', first: 100, after: 'invalid' }),
  ).rejects.toMatchObject({ code: 'INVENTORY_RESTART_REQUIRED' })
  await expect(
    provider(binding, {
      kind: 'groups',
      first: 100,
      filters: { typeId: 100 },
      after: page.groups.endCursor!,
    }),
  ).rejects.toMatchObject({ code: 'INVENTORY_RESTART_REQUIRED' })
})

test('keeps unsupported legacy observations as explicit gaps and never publishes guessed quantities', async () => {
  for (const quantity of [-2, 0, 1.5]) {
    const tuple = await seedLegacy(
      { ...authority, characterId: 90_000_300 + Math.trunc(quantity * 10) },
      [asset(20, { quantity })],
    )
    expect(await operation('member-audit/backfill-asset-inventory')({ subjects: [tuple] })).toEqual(
      { projected: 0 },
    )
    expect(await readers().readInventorySources({ subjects: [tuple] })).toMatchObject([
      { observationId: tuple.observationId, ready: false },
    ])
    expect((await groups([{ ...tuple, stale: false }])).groups).toEqual([])
  }
})

test('does not age-purge the latest asset projection and rejects malformed identity backfill', async () => {
  const tuple = await promote(
    { ...authority, characterId: 90_000_460, characterLifecycleId: randomUUID() },
    [asset(70)],
  )
  expect(
    await operation('member-audit/purge-evidence')({
      mode: 'retention',
      store: 'assets',
      limit: 100,
      cutoff: new Date(Date.parse(validatedAt) + 120 * 86_400_000).toISOString(),
    }),
  ).toEqual({ deleted: 0, remaining: false })
  expect((await groups([{ ...tuple, stale: true }])).groups[0]?.staleQuantity).toBe('3')
  const invalid = await seedLegacy(
    { ...authority, characterId: 90_000_461, characterLifecycleId: randomUUID() },
    [asset(70.5)],
  )
  expect(await operation('member-audit/backfill-asset-inventory')({ subjects: [invalid] })).toEqual(
    { projected: 0 },
  )
  expect(await readers().readInventorySources({ subjects: [invalid] })).toMatchObject([
    { ready: false },
  ])
})

test('cascades privacy and authority purges and never revives old bindings after lifecycle changes', async () => {
  const purge = operation('member-audit/purge-evidence')
  for (const mode of ['authority', 'account', 'organization'] as const) {
    const current = {
      ...authority,
      organizationVersion: 10 + mode.length,
      targetUserId: randomUUID(),
      characterId: 90_000_400 + mode.length,
    }
    const tuple = await promote(current, [asset(30)])
    const base = { store: 'assets' as const, limit: 100 }
    let result
    if (mode === 'authority') result = await purge({ ...base, ...current, mode })
    if (mode === 'account')
      result = await purge({ ...base, targetUserId: current.targetUserId, mode })
    if (mode === 'organization')
      result = await purge({ ...base, organizationVersion: current.organizationVersion, mode })
    expect(result).toMatchObject({ deleted: 1 })
    const [count] =
      await connection`select count(*)::int as count from eve_module_member_audit.asset_inventory_items where character_id = ${current.characterId}`
    expect(count?.count).toBe(0)
    expect(await readers().readInventorySources({ subjects: [tuple] })).toMatchObject([
      { observationId: null, ready: false },
    ])
  }
  const current = { ...authority, characterId: 90_000_450, characterLifecycleId: randomUUID() }
  const old = await promote(current, [asset(40)])
  const changed = {
    ...current,
    characterLifecycleId: randomUUID(),
    managedMemberLifecycleId: randomUUID(),
    targetUserId: randomUUID(),
    authorizationGeneration: 2,
    disclosureVersion: 2,
    sectionActivationVersion: 2,
  }
  const latest = await promote(changed, [asset(41)])
  expect((await groups([{ ...old, stale: false }])).groups).toEqual([])
  expect(await operation('member-audit/backfill-asset-inventory')({ subjects: [old] })).toEqual({
    projected: 0,
  })
  expect((await groups([{ ...latest, stale: false }])).groups[0]?.currentQuantity).toBe('3')
  const [oldRows] =
    await connection`select count(*)::int as count from eve_module_member_audit.asset_inventory_items where character_id = ${current.characterId} and observation_id = ${old.observationId}`
  expect(oldRows?.count).toBe(0)
})
