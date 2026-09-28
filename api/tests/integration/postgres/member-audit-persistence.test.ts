import { randomUUID } from 'node:crypto'
import { bindPlatformPersistenceOperation } from '@eve-space/platform-module-server'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  createStandaloneModulePersistenceOperationInvoker,
  createTransactionScopedModulePersistenceOperationInvoker,
} from '../../../src/db/module-persistence-operation-transaction.js'
import { persistenceContractFingerprintFor } from '../../../src/db/module-persistence-attestation.js'
import { runStartupMigrations } from '../../../src/db/startup-migrations.js'
import {
  installedModulePersistenceOperationCatalog,
  installedModulePersistenceOperations,
} from '../../../src/generated/platform/installed-module-persistence.js'
import { installedModuleMigrations } from '../../../src/generated/platform/installed-module-migrations.js'

let container: StartedTestContainer
let connection: postgres.Sql
let databaseUrl: string

const memberAuditAuthority = {
  authorizationGeneration: 1,
  characterId: 90_000_101,
  characterLifecycleId: '73333333-3333-4333-8333-333333333333',
  disclosureVersion: 1,
  managedMemberLifecycleId: '72222222-2222-4222-8222-222222222222',
  organizationVersion: 1,
  sectionActivationVersion: 1,
  targetUserId: '71111111-1111-4111-8111-111111111111',
} as const

const continuationIdentity = {
  sectionId: 'assets' as const,
  resourceId: 'assets' as const,
  operationContractRevision: 1,
  resourceRevision: 1,
  ...memberAuditAuthority,
  observationId: '74444444-4444-4444-8444-444444444444',
}

function memberAuditInvoker(options: { readonly readOnly?: boolean } = {}) {
  return createStandaloneModulePersistenceOperationInvoker(
    connection,
    'member-audit',
    installedModulePersistenceOperations,
    options,
  )
}

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
  databaseUrl = `postgres://eve_space:${password}@${container.getHost()}:${container.getMappedPort(5432)}/eve_space`
  connection = postgres(databaseUrl)
  await runStartupMigrations(connection)
})

afterAll(async () => {
  await connection?.end()
  await container?.stop()
})

test('retains the squashed baseline and applies the current-observation migration once', async () => {
  const databaseName = 'member_audit_upgrade'
  await connection.unsafe(`create database ${databaseName}`).simple()
  const upgradeUrl = new URL(databaseUrl)
  upgradeUrl.pathname = `/${databaseName}`
  const upgradeConnection = postgres(upgradeUrl.toString())
  const legacyMigrations = installedModuleMigrations.filter(
    ({ moduleId, name }) => moduleId === 'member-audit' && name.endsWith('001-baseline.sql'),
  )
  const legacyOperations = installedModulePersistenceOperations.filter(
    ({ moduleId, migration }) =>
      moduleId === 'member-audit' && migration.endsWith('001-baseline.sql'),
  )

  try {
    await runStartupMigrations(upgradeConnection, {
      installed: legacyMigrations,
      moduleIds: ['member-audit'],
      persistenceContractFingerprint: persistenceContractFingerprintFor(legacyOperations, [
        'member-audit',
      ]),
      persistenceOperations: legacyOperations,
    })
    await runStartupMigrations(upgradeConnection)

    const migrations = await upgradeConnection<{ name: string }[]>`
      select name
      from public.schema_migrations
      where module = 'member-audit'
      order by name
    `
    expect([...migrations]).toStrictEqual([
      { name: 'member-audit-001-baseline.sql' },
      { name: 'member-audit-002-current-observation.sql' },
    ])
  } finally {
    await upgradeConnection.end()
  }
})

test('atomically replaces independent current observations with full authority and rolls back failed writes', async () => {
  const writeOperation =
    installedModulePersistenceOperationCatalog['member-audit/write-current-observation']
  const readOperation =
    installedModulePersistenceOperationCatalog['member-audit/read-current-observation']
  const write = bindPlatformPersistenceOperation(writeOperation, memberAuditInvoker())
  const read = bindPlatformPersistenceOperation(
    readOperation,
    memberAuditInvoker({ readOnly: true }),
  )
  const now = new Date()
  const validatedAt = now.toISOString()
  const cachedUntil = new Date(now.getTime() + 60_000).toISOString()
  const common = {
    ...memberAuditAuthority,
    dtoRevision: 1 as const,
    validatedAt,
    cachedUntil,
  }
  const ship = {
    kind: 'current-ship' as const,
    typeId: 34,
    typeName: 'Merlin',
    groupId: 25,
    groupName: 'Frigate',
    name: 'First ship',
  }
  const location = {
    kind: 'current-location' as const,
    solarSystemId: 30_000_001,
    solarSystemName: 'System',
    solarSystemSecurityStatus: null,
    locationType: 'space' as const,
  }
  await expect(
    write({ ...common, resourceId: 'current-ship', snapshot: ship, observationId: randomUUID() }),
  ).resolves.toStrictEqual({ outcome: 'applied' })
  await expect(
    write({
      ...common,
      resourceId: 'current-location',
      snapshot: location,
      observationId: randomUUID(),
    }),
  ).resolves.toStrictEqual({ outcome: 'applied' })
  const first = await read(memberAuditAuthority)
  expect(first).toMatchObject({
    currentShip: { snapshot: ship },
    currentLocation: { snapshot: location },
  })
  expect(new Date(first.currentShip!.validatedAt).toISOString()).toBe(validatedAt)
  expect(new Date(first.currentShip!.cachedUntil).toISOString()).toBe(cachedUntil)
  expect(new Date(first.currentLocation!.validatedAt).toISOString()).toBe(validatedAt)

  const newer = {
    ...common,
    validatedAt: new Date(now.getTime() + 1000).toISOString(),
    cachedUntil: new Date(now.getTime() + 61_000).toISOString(),
    resourceId: 'current-ship' as const,
    observationId: randomUUID(),
    snapshot: { ...ship, name: 'Second ship' },
  }
  await expect(write(newer)).resolves.toStrictEqual({ outcome: 'applied' })
  expect(await read(memberAuditAuthority)).toMatchObject({
    currentShip: { snapshot: newer.snapshot },
    currentLocation: { snapshot: location },
  })
  await expect(
    write({
      ...common,
      resourceId: 'current-ship',
      snapshot: ship,
      observationId: randomUUID(),
      validatedAt: new Date(now.getTime() - 1000).toISOString(),
    }),
  ).resolves.toStrictEqual({ outcome: 'obsolete' })
  await expect(
    read({ ...memberAuditAuthority, authorizationGeneration: 2 }),
  ).resolves.toStrictEqual({ currentShip: null, currentLocation: null })
  const [count] = await connection<{ count: number }[]>`
    select count(*)::integer as count from eve_module_member_audit.current_observation_snapshots
    where character_id = ${memberAuditAuthority.characterId}
  `
  expect(count?.count).toBe(2)

  const nextGeneration = { ...memberAuditAuthority, authorizationGeneration: 2 }
  const generationShip = {
    ...newer,
    ...nextGeneration,
    observationId: randomUUID(),
    validatedAt: new Date(now.getTime() + 3000).toISOString(),
    cachedUntil: new Date(now.getTime() + 63_000).toISOString(),
    snapshot: { ...ship, name: 'New generation ship' },
  }
  await write(generationShip)
  expect(await read(nextGeneration)).toMatchObject({
    currentShip: { snapshot: generationShip.snapshot },
    currentLocation: null,
  })
  const generationLocation = {
    ...common,
    ...nextGeneration,
    resourceId: 'current-location' as const,
    observationId: randomUUID(),
    validatedAt: new Date(now.getTime() + 3000).toISOString(),
    cachedUntil: new Date(now.getTime() + 63_000).toISOString(),
    snapshot: { ...location, solarSystemId: 30_000_002 },
  }
  await write(generationLocation)
  expect(await read(nextGeneration)).toMatchObject({
    currentShip: { snapshot: generationShip.snapshot },
    currentLocation: { snapshot: generationLocation.snapshot },
  })
  await expect(read(memberAuditAuthority)).resolves.toStrictEqual({
    currentShip: null,
    currentLocation: null,
  })

  await expect(
    connection.begin(async (transaction) => {
      const scoped = createTransactionScopedModulePersistenceOperationInvoker(
        transaction,
        'member-audit',
        installedModulePersistenceOperations,
      )
      await scoped.invoke(writeOperation, {
        ...generationShip,
        observationId: randomUUID(),
        validatedAt: new Date(now.getTime() + 4000).toISOString(),
        cachedUntil: new Date(now.getTime() + 64_000).toISOString(),
        snapshot: { ...ship, name: 'Rolled back ship' },
      })
      scoped.close()
      throw new Error('rollback observation')
    }),
  ).rejects.toThrow('rollback observation')
  expect(await read(nextGeneration)).toMatchObject({
    currentShip: { snapshot: generationShip.snapshot },
  })
  const [foreignKeys] = await connection<{ count: number }[]>`
    select count(*)::integer as count from pg_constraint
    where conrelid = 'eve_module_member_audit.current_observation_snapshots'::regclass
      and contype = 'f'
  `
  expect(foreignKeys?.count).toBe(0)
})

test('hides observations immediately at upstream expiry or the 24-hour readable ceiling', async () => {
  const write = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/write-current-observation'],
    memberAuditInvoker(),
  )
  const read = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/read-current-observation'],
    memberAuditInvoker({ readOnly: true }),
  )
  const authority = { ...memberAuditAuthority, characterId: 90_000_202 }
  const now = Date.now()
  const ship = {
    kind: 'current-ship' as const,
    typeId: 34,
    typeName: 'Merlin',
    groupId: 25,
    groupName: 'Frigate',
    name: 'Expired ship',
  }
  const location = {
    kind: 'current-location' as const,
    solarSystemId: 30_000_001,
    solarSystemName: 'System',
    solarSystemSecurityStatus: null,
    locationType: 'space' as const,
  }
  const shared = { ...authority, dtoRevision: 1 as const }
  await write({
    ...shared,
    resourceId: 'current-ship',
    snapshot: ship,
    observationId: randomUUID(),
    validatedAt: new Date(now - 60_000).toISOString(),
    cachedUntil: new Date(now - 1000).toISOString(),
  })
  await write({
    ...shared,
    resourceId: 'current-location',
    snapshot: location,
    observationId: randomUUID(),
    validatedAt: new Date(now - 24 * 60 * 60 * 1000 - 1000).toISOString(),
    cachedUntil: new Date(now + 60_000).toISOString(),
  })
  await expect(read(authority)).resolves.toStrictEqual({ currentShip: null, currentLocation: null })
  const expiredStates = await connection<{ resource_id: string; state: string }[]>`
    select resource_id,
      public.platform_current_observation_state(validated_at, cached_until, now()) as state
    from eve_module_member_audit.current_observation_snapshots
    where character_id = ${authority.characterId}
    order by resource_id
  `
  expect([...expiredStates]).toStrictEqual([
    { resource_id: 'current-location', state: 'unavailable' },
    { resource_id: 'current-ship', state: 'unavailable' },
  ])

  const currentShip = { ...ship, name: 'Fresh ship' }
  await write({
    ...shared,
    resourceId: 'current-ship',
    snapshot: currentShip,
    observationId: randomUUID(),
    validatedAt: new Date(now).toISOString(),
    cachedUntil: new Date(now + 60_000).toISOString(),
  })
  expect(await read(authority)).toMatchObject({
    currentShip: { snapshot: currentShip },
    currentLocation: null,
  })
  const [freshState] = await connection<{ state: string }[]>`
    select public.platform_current_observation_state(validated_at, cached_until, now()) as state
    from eve_module_member_audit.current_observation_snapshots
    where character_id = ${authority.characterId} and resource_id = 'current-ship'
  `
  expect(freshState?.state).toBe('current')
})

test('purges expired and invalid-authority observations without deleting a newer generation', async () => {
  const write = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/write-current-observation'],
    memberAuditInvoker(),
  )
  const read = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/read-current-observation'],
    memberAuditInvoker({ readOnly: true }),
  )
  const purge = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/purge-current-observation'],
    memberAuditInvoker(),
  )
  const authority = {
    ...memberAuditAuthority,
    characterId: 90_000_303,
    targetUserId: '70000000-0000-4000-8000-000000000303',
  }
  const now = Date.now()
  const ship = {
    kind: 'current-ship' as const,
    typeId: 34,
    typeName: 'Merlin',
    groupId: 25,
    groupName: 'Frigate',
    name: 'Old vessel',
  }
  const location = {
    kind: 'current-location' as const,
    solarSystemId: 30_000_001,
    solarSystemName: 'System',
    solarSystemSecurityStatus: null,
    locationType: 'space' as const,
  }
  const common = { ...authority, dtoRevision: 1 as const }
  await write({
    ...common,
    resourceId: 'current-ship',
    snapshot: ship,
    observationId: randomUUID(),
    validatedAt: new Date(now - 60_000).toISOString(),
    cachedUntil: new Date(now - 30_000).toISOString(),
  })
  await write({
    ...common,
    resourceId: 'current-location',
    snapshot: location,
    observationId: randomUUID(),
    validatedAt: new Date(now).toISOString(),
    cachedUntil: new Date(now + 60_000).toISOString(),
  })
  await expect(
    purge({
      mode: 'retention',
      store: 'current-ship',
      cutoff: new Date(now).toISOString(),
      limit: 10,
    }),
  ).resolves.toStrictEqual({ deleted: 1, remaining: false })
  expect(await read(authority)).toMatchObject({
    currentShip: null,
    currentLocation: { snapshot: location },
  })

  const nextGeneration = { ...authority, authorizationGeneration: 2 }
  await write({
    ...common,
    ...nextGeneration,
    resourceId: 'current-ship',
    snapshot: { ...ship, name: 'New vessel' },
    observationId: randomUUID(),
    validatedAt: new Date(now + 1000).toISOString(),
    cachedUntil: new Date(now + 61_000).toISOString(),
  })
  await expect(
    purge({ mode: 'authority', store: 'current-ship', ...authority, limit: 10 }),
  ).resolves.toStrictEqual({ deleted: 0, remaining: false })
  for (const mismatch of [
    { organizationVersion: 2 },
    { targetUserId: randomUUID() },
    { managedMemberLifecycleId: randomUUID() },
    { characterLifecycleId: randomUUID() },
    { authorizationGeneration: 3 },
    { disclosureVersion: 2 },
    { sectionActivationVersion: 2 },
  ]) {
    await expect(
      purge({
        mode: 'authority',
        store: 'current-ship',
        ...nextGeneration,
        ...mismatch,
        limit: 10,
      }),
    ).resolves.toStrictEqual({ deleted: 0, remaining: false })
  }
  expect(await read(nextGeneration)).toMatchObject({
    currentShip: { snapshot: { name: 'New vessel' } },
    currentLocation: null,
  })
  await expect(
    purge({
      mode: 'account',
      store: 'current-location',
      targetUserId: authority.targetUserId,
      limit: 10,
    }),
  ).resolves.toStrictEqual({ deleted: 1, remaining: false })
  await expect(
    purge({
      mode: 'account',
      store: 'current-ship',
      targetUserId: authority.targetUserId,
      limit: 10,
    }),
  ).resolves.toStrictEqual({ deleted: 1, remaining: false })
  const [count] = await connection<{ count: number }[]>`
    select count(*)::integer as count from eve_module_member_audit.current_observation_snapshots
    where character_id = ${authority.characterId}
  `
  expect(count?.count).toBe(0)
})

test.each([
  ['detachment', { characterLifecycleId: '80000000-0000-4000-8000-000000000001' }, 90_000_601],
  ['transfer', { targetUserId: '80000000-0000-4000-8000-000000000002' }, 90_000_602],
  [
    'departure and re-entry',
    { managedMemberLifecycleId: '80000000-0000-4000-8000-000000000003' },
    90_000_603,
  ],
  ['organization replacement', { organizationVersion: 2 }, 90_000_604],
  ['reauthorization', { authorizationGeneration: 2 }, 90_000_605],
  ['disclosure change', { disclosureVersion: 2 }, 90_000_606],
  ['section reactivation', { sectionActivationVersion: 2 }, 90_000_607],
] as const)('purges both old observations after %s', async (_label, changed, characterId) => {
  const write = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/write-current-observation'],
    memberAuditInvoker(),
  )
  const read = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/read-current-observation'],
    memberAuditInvoker({ readOnly: true }),
  )
  const purge = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/purge-current-observation'],
    memberAuditInvoker(),
  )
  const authority = { ...memberAuditAuthority, characterId }
  const now = new Date()
  const common = {
    ...authority,
    dtoRevision: 1 as const,
    validatedAt: now.toISOString(),
    cachedUntil: new Date(now.getTime() + 60_000).toISOString(),
  }
  await write({
    ...common,
    resourceId: 'current-ship',
    observationId: randomUUID(),
    snapshot: {
      kind: 'current-ship',
      typeId: 34,
      typeName: 'Merlin',
      groupId: 25,
      groupName: 'Frigate',
      name: 'Old ship',
    },
  })
  await write({
    ...common,
    resourceId: 'current-location',
    observationId: randomUUID(),
    snapshot: {
      kind: 'current-location',
      solarSystemId: 30_000_001,
      solarSystemName: 'System',
      solarSystemSecurityStatus: null,
      locationType: 'space',
    },
  })
  await expect(read({ ...authority, ...changed })).resolves.toStrictEqual({
    currentShip: null,
    currentLocation: null,
  })
  for (const store of ['current-ship', 'current-location'] as const) {
    await expect(
      purge({ mode: 'authority', store, ...authority, limit: 1 }),
    ).resolves.toStrictEqual({ deleted: 1, remaining: true })
    await expect(
      purge({ mode: 'authority', store, ...authority, limit: 1 }),
    ).resolves.toStrictEqual({ deleted: 0, remaining: false })
  }
  const [remaining] = await connection<{ count: number }[]>`
    select count(*)::integer as count from eve_module_member_audit.current_observation_snapshots
    where character_id = ${authority.characterId}
  `
  expect(remaining?.count).toBe(0)
})

test('bounds organization-version purge batches and preserves replacement-version snapshots', async () => {
  const write = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/write-current-observation'],
    memberAuditInvoker(),
  )
  const purge = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/purge-current-observation'],
    memberAuditInvoker(),
  )
  const now = new Date()
  for (const characterId of [90_000_401, 90_000_402]) {
    await write({
      ...memberAuditAuthority,
      organizationVersion: 31,
      characterId,
      dtoRevision: 1,
      resourceId: 'current-ship',
      observationId: randomUUID(),
      snapshot: {
        kind: 'current-ship',
        typeId: 34,
        typeName: 'Merlin',
        groupId: 25,
        groupName: 'Frigate',
        name: 'Version one',
      },
      validatedAt: now.toISOString(),
      cachedUntil: new Date(now.getTime() + 60_000).toISOString(),
    })
  }
  await write({
    ...memberAuditAuthority,
    characterId: 90_000_403,
    organizationVersion: 32,
    dtoRevision: 1,
    resourceId: 'current-ship',
    observationId: randomUUID(),
    snapshot: {
      kind: 'current-ship',
      typeId: 34,
      typeName: 'Merlin',
      groupId: 25,
      groupName: 'Frigate',
      name: 'Version two',
    },
    validatedAt: now.toISOString(),
    cachedUntil: new Date(now.getTime() + 60_000).toISOString(),
  })
  const input = {
    mode: 'organization' as const,
    organizationVersion: 31,
    store: 'current-ship' as const,
    limit: 1,
  }
  await expect(purge(input)).resolves.toStrictEqual({ deleted: 1, remaining: true })
  await expect(purge(input)).resolves.toStrictEqual({ deleted: 1, remaining: true })
  await expect(purge(input)).resolves.toStrictEqual({ deleted: 0, remaining: false })
  const [remaining] = await connection<{ character_id: string }[]>`
    select character_id::text from eve_module_member_audit.current_observation_snapshots
    where character_id in (90000401, 90000402, 90000403)
  `
  expect(remaining?.character_id).toBe('90000403')
})

test('replaces trained snapshots across authority revisions', async () => {
  const operation =
    installedModulePersistenceOperationCatalog['member-audit/materialize-current-snapshot']
  const materializeCurrentSnapshot = bindPlatformPersistenceOperation(
    operation,
    createStandaloneModulePersistenceOperationInvoker(
      connection,
      'member-audit',
      installedModulePersistenceOperations,
    ),
  )
  const initial = {
    authorizationGeneration: 1,
    characterId: 90_000_001,
    characterLifecycleId: '33333333-3333-4333-8333-333333333333',
    disclosureVersion: 1,
    dtoRevision: 1,
    managedMemberLifecycleId: '22222222-2222-4222-8222-222222222222',
    observationId: '70000000-0000-4000-8000-000000000001',
    organizationVersion: 1,
    resourceId: 'trained-skills' as const,
    sectionActivationVersion: 1,
    snapshot: {
      groups: [],
      injectedSkillCount: 0,
      kind: 'trained-skills' as const,
      totalSp: 0,
      unallocatedSp: 0,
    },
    targetUserId: '11111111-1111-4111-8111-111111111111',
    validatedAt: '2026-09-17T10:00:00Z',
  }
  const revisions = [
    {
      ...initial,
      authorizationGeneration: 2,
      observationId: '70000000-0000-4000-8000-000000000002',
      validatedAt: '2026-09-17T09:59:00Z',
    },
    {
      ...initial,
      authorizationGeneration: 2,
      managedMemberLifecycleId: '44444444-4444-4444-8444-444444444444',
      observationId: '70000000-0000-4000-8000-000000000003',
      validatedAt: '2026-09-17T09:58:00Z',
    },
    {
      ...initial,
      authorizationGeneration: 2,
      characterLifecycleId: '55555555-5555-4555-8555-555555555555',
      managedMemberLifecycleId: '44444444-4444-4444-8444-444444444444',
      observationId: '70000000-0000-4000-8000-000000000004',
      validatedAt: '2026-09-17T09:57:00Z',
    },
    {
      ...initial,
      authorizationGeneration: 2,
      characterLifecycleId: '55555555-5555-4555-8555-555555555555',
      disclosureVersion: 2,
      managedMemberLifecycleId: '44444444-4444-4444-8444-444444444444',
      observationId: '70000000-0000-4000-8000-000000000005',
      validatedAt: '2026-09-17T09:56:00Z',
    },
    {
      ...initial,
      authorizationGeneration: 2,
      characterLifecycleId: '55555555-5555-4555-8555-555555555555',
      disclosureVersion: 2,
      managedMemberLifecycleId: '44444444-4444-4444-8444-444444444444',
      observationId: '70000000-0000-4000-8000-000000000006',
      sectionActivationVersion: 2,
      validatedAt: '2026-09-17T09:55:00Z',
    },
    {
      ...initial,
      authorizationGeneration: 2,
      characterLifecycleId: '55555555-5555-4555-8555-555555555555',
      disclosureVersion: 2,
      managedMemberLifecycleId: '44444444-4444-4444-8444-444444444444',
      observationId: '70000000-0000-4000-8000-000000000007',
      organizationVersion: 2,
      sectionActivationVersion: 2,
      validatedAt: '2026-09-17T09:54:00Z',
    },
    {
      ...initial,
      authorizationGeneration: 2,
      characterLifecycleId: '55555555-5555-4555-8555-555555555555',
      disclosureVersion: 2,
      managedMemberLifecycleId: '44444444-4444-4444-8444-444444444444',
      observationId: '70000000-0000-4000-8000-000000000008',
      organizationVersion: 2,
      sectionActivationVersion: 2,
      targetUserId: '66666666-6666-4666-8666-666666666666',
      validatedAt: '2026-09-17T09:53:00Z',
    },
  ]

  await expect(materializeCurrentSnapshot(initial)).resolves.toStrictEqual({ outcome: 'applied' })
  for (const revision of revisions) {
    await expect(materializeCurrentSnapshot(revision)).resolves.toStrictEqual({
      outcome: 'applied',
    })
  }

  const finalRevision = revisions[6]!
  await expect(
    materializeCurrentSnapshot({
      ...finalRevision,
      observationId: '70000000-0000-4000-8000-000000000009',
      validatedAt: '2026-09-17T09:52:00Z',
    }),
  ).resolves.toStrictEqual({ outcome: 'obsolete' })

  const snapshots = await connection<
    {
      authorizationGeneration: number
      characterLifecycleId: string
      count: number
      disclosureVersion: number
      managedMemberLifecycleId: string
      organizationVersion: number
      sectionActivationVersion: number
      targetUserId: string
      validatedAt: Date
    }[]
  >`
    select
      count(*) over ()::integer as count,
      organization_version::integer as "organizationVersion",
      target_user_id as "targetUserId",
      managed_member_lifecycle_id as "managedMemberLifecycleId",
      character_lifecycle_id as "characterLifecycleId",
      authorization_generation as "authorizationGeneration",
      disclosure_version as "disclosureVersion",
      section_activation_version as "sectionActivationVersion",
      validated_at as "validatedAt"
    from eve_module_member_audit.trained_skill_snapshots
    where character_id = 90000001
  `
  expect([...snapshots]).toStrictEqual([
    {
      authorizationGeneration: 2,
      characterLifecycleId: '55555555-5555-4555-8555-555555555555',
      count: 1,
      disclosureVersion: 2,
      managedMemberLifecycleId: '44444444-4444-4444-8444-444444444444',
      organizationVersion: 2,
      sectionActivationVersion: 2,
      targetUserId: '66666666-6666-4666-8666-666666666666',
      validatedAt: new Date('2026-09-17T09:53:00Z'),
    },
  ])
})

test('replaces a wallet balance after its authority changes despite an older cached response', async () => {
  const materializeCurrentSnapshot = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/materialize-current-snapshot'],
    memberAuditInvoker(),
  )
  const initial = {
    authorizationGeneration: 1,
    characterId: 90_000_008,
    characterLifecycleId: '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    disclosureVersion: 1,
    dtoRevision: 1,
    managedMemberLifecycleId: '89999999-9999-4999-8999-999999999999',
    observationId: '8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    organizationVersion: 1,
    resourceId: 'wallet-balance' as const,
    sectionActivationVersion: 1,
    snapshot: { balance: 10, kind: 'wallet-balance' as const },
    targetUserId: '88888888-8888-4888-8888-888888888888',
    validatedAt: '2026-09-17T10:00:00Z',
  }
  const changedAuthority = {
    ...initial,
    authorizationGeneration: 2,
    observationId: '8ccccccc-cccc-4ccc-8ccc-cccccccccccc',
    snapshot: { balance: 20, kind: 'wallet-balance' as const },
    validatedAt: '2026-09-17T09:59:00Z',
  }

  await expect(materializeCurrentSnapshot(initial)).resolves.toStrictEqual({ outcome: 'applied' })
  await expect(
    materializeCurrentSnapshot({
      ...initial,
      observationId: '8ddddddd-dddd-4ddd-8ddd-dddddddddddd',
      snapshot: { balance: 15, kind: 'wallet-balance' },
      validatedAt: '2026-09-17T09:58:00Z',
    }),
  ).resolves.toStrictEqual({ outcome: 'obsolete' })
  await expect(materializeCurrentSnapshot(changedAuthority)).resolves.toStrictEqual({
    outcome: 'applied',
  })
  await expect(
    connection<{ authorizationGeneration: number; balance: number; validatedAt: Date }[]>`
      select
        authorization_generation as "authorizationGeneration",
        (snapshot ->> 'balance')::integer as balance,
        validated_at as "validatedAt"
      from eve_module_member_audit.wallet_balance_snapshots
      where character_id = ${changedAuthority.characterId}
    `.then((rows) => [...rows]),
  ).resolves.toStrictEqual([
    {
      authorizationGeneration: 2,
      balance: 20,
      validatedAt: new Date('2026-09-17T09:59:00Z'),
    },
  ])
})

test('attests the declared routines and denies the runtime role direct table access', async () => {
  const [state] = await connection<
    {
      attestationCount: number
      migrationCount: number
      moduleTableAccess: boolean
      publicTableAccess: boolean
      routineAccess: boolean
    }[]
  >`
    select
      (
        select count(*)::integer
        from public.module_persistence_operation_attestations
        where module_id = 'member-audit'
      ) as "attestationCount",
      (
        select count(*)::integer
        from public.schema_migrations
        where module = 'member-audit'
      ) as "migrationCount",
      has_table_privilege(
        'eve_module_member_audit_runtime',
        'eve_module_member_audit.asset_snapshots',
        'SELECT, INSERT, UPDATE, DELETE'
      ) as "moduleTableAccess",
      has_table_privilege(
        'eve_module_member_audit_runtime',
        'public.users',
        'SELECT, INSERT, UPDATE, DELETE'
      ) as "publicTableAccess",
      has_function_privilege(
        'eve_module_member_audit_runtime',
        'eve_module_member_audit.persist_read_asset_evidence(jsonb)',
        'EXECUTE'
      ) as "routineAccess"
  `

  expect(state).toStrictEqual({
    attestationCount: 14,
    migrationCount: 2,
    moduleTableAccess: false,
    publicTableAccess: false,
    routineAccess: true,
  })
  expect(
    installedModulePersistenceOperationCatalog['member-audit/read-asset-evidence'].grants,
  ).toStrictEqual({
    activityProviders: [],
    resourceMaterializations: [],
    resourceProjections: [],
    routes: ['assets-detail'],
  })
  expect(
    installedModulePersistenceOperationCatalog['member-audit/write-evidence-continuation'].grants
      .routes,
  ).toStrictEqual([])
  await expect(
    connection.begin(async (transaction) => {
      await transaction`set local role eve_module_member_audit_runtime`
      await transaction`select id from public.users limit 1`
    }),
  ).rejects.toMatchObject({ code: '42501' })
})

test('keeps incomplete observations isolated and promotes complete assets idempotently', async () => {
  const writeContinuation = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/write-evidence-continuation'],
    memberAuditInvoker(),
  )
  const readContinuation = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/read-evidence-continuation'],
    memberAuditInvoker({ readOnly: true }),
  )
  const readActiveContinuation = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/read-active-evidence-continuation'],
    memberAuditInvoker({ readOnly: true }),
  )
  const promoteObservation = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/promote-evidence-observation'],
    memberAuditInvoker(),
  )
  const readAssets = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/read-asset-evidence'],
    memberAuditInvoker({ readOnly: true }),
  )
  const validatedAt = '2026-09-17T11:00:00Z'

  await expect(
    writeContinuation({
      ...continuationIdentity,
      checkpoint: { page: 1 },
      expectedRevision: 0,
      records: [
        {
          recordKind: 'asset',
          sourceId: 'asset-1',
          sourceTimestamp: validatedAt,
          evidence: { itemId: 1, typeName: 'Veldspar' },
          validatedAt,
        },
      ],
      updatedAt: validatedAt,
    }),
  ).resolves.toStrictEqual({ outcome: 'applied', revision: 1 })
  await expect(readContinuation(continuationIdentity)).resolves.toStrictEqual({
    checkpoint: { page: 1 },
    revision: 1,
  })
  await expect(
    readActiveContinuation({
      operationContractRevision: continuationIdentity.operationContractRevision,
      resourceId: continuationIdentity.resourceId,
      resourceRevision: continuationIdentity.resourceRevision,
      sectionId: continuationIdentity.sectionId,
      ...memberAuditAuthority,
    }),
  ).resolves.toStrictEqual({
    checkpoint: { page: 1 },
    observationId: continuationIdentity.observationId,
    revision: 1,
  })
  await expect(readAssets(memberAuditAuthority)).resolves.toBeNull()
  const incompletePromotion = {
    ...continuationIdentity,
    dtoRevision: 1,
    expectedRevision: 1,
    validatedAt,
  }
  await expect(promoteObservation(incompletePromotion)).resolves.toStrictEqual({
    outcome: 'obsolete',
  })
  await expect(readAssets(memberAuditAuthority)).resolves.toBeNull()
  await expect(
    writeContinuation({
      ...continuationIdentity,
      checkpoint: { page: 2 },
      expectedRevision: 0,
      records: [],
      updatedAt: '2026-09-17T11:01:00Z',
    }),
  ).resolves.toStrictEqual({ outcome: 'obsolete' })
  await expect(
    writeContinuation({
      ...continuationIdentity,
      checkpoint: { complete: 'true' },
      expectedRevision: 1,
      records: [],
      updatedAt: '2026-09-17T11:01:00Z',
    }),
  ).resolves.toStrictEqual({ outcome: 'applied', revision: 2 })
  await expect(
    promoteObservation({
      ...continuationIdentity,
      dtoRevision: 1,
      expectedRevision: 2,
      validatedAt,
    }),
  ).resolves.toStrictEqual({ outcome: 'obsolete' })
  await expect(
    writeContinuation({
      ...continuationIdentity,
      checkpoint: { complete: true },
      expectedRevision: 2,
      records: [],
      updatedAt: '2026-09-17T11:01:00Z',
    }),
  ).resolves.toStrictEqual({ outcome: 'applied', revision: 3 })

  const promotion = {
    ...continuationIdentity,
    dtoRevision: 1,
    expectedRevision: 3,
    validatedAt,
  }
  await expect(promoteObservation(promotion)).resolves.toStrictEqual({ outcome: 'applied' })
  await expect(promoteObservation(promotion)).resolves.toStrictEqual({ outcome: 'applied' })
  await expect(
    writeContinuation({
      ...continuationIdentity,
      checkpoint: { page: 2 },
      expectedRevision: 0,
      records: [
        {
          recordKind: 'asset',
          sourceId: 'asset-retry',
          sourceTimestamp: validatedAt,
          evidence: { itemId: 99 },
          validatedAt,
        },
      ],
      updatedAt: validatedAt,
    }),
  ).resolves.toStrictEqual({ outcome: 'obsolete' })
  await expect(
    writeContinuation({
      ...continuationIdentity,
      checkpoint: { page: 2 },
      expectedRevision: 1,
      observationId: '70000000-0000-4000-8000-000000000010',
      records: [],
      updatedAt: validatedAt,
    }),
  ).resolves.toStrictEqual({ outcome: 'obsolete' })
  await expect(readAssets(memberAuditAuthority)).resolves.toMatchObject({
    observationId: continuationIdentity.observationId,
    snapshot: { kind: 'assets', records: [{ itemId: 1, typeName: 'Veldspar' }] },
  })

  const incompleteIdentity = {
    ...continuationIdentity,
    observationId: '75555555-5555-4555-8555-555555555555',
  }
  await writeContinuation({
    ...incompleteIdentity,
    checkpoint: { page: 1 },
    expectedRevision: 0,
    records: [
      {
        recordKind: 'asset',
        sourceId: 'asset-2',
        sourceTimestamp: '2026-09-17T11:02:00Z',
        evidence: { itemId: 2, typeName: 'Scordite' },
        validatedAt: '2026-09-17T11:02:00Z',
      },
    ],
    updatedAt: '2026-09-17T11:02:00Z',
  })
  await expect(readAssets(memberAuditAuthority)).resolves.toMatchObject({
    observationId: continuationIdentity.observationId,
  })
})

test('replaces an asset snapshot when its authority changes without a newer validation time', async () => {
  const writeContinuation = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/write-evidence-continuation'],
    memberAuditInvoker(),
  )
  const promoteObservation = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/promote-evidence-observation'],
    memberAuditInvoker(),
  )
  const readAssets = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/read-asset-evidence'],
    memberAuditInvoker({ readOnly: true }),
  )
  const firstAuthority = {
    ...memberAuditAuthority,
    characterId: 90_000_104,
    characterLifecycleId: '70000000-0000-4000-8000-000000000013',
    managedMemberLifecycleId: '70000000-0000-4000-8000-000000000012',
    organizationVersion: 3,
    targetUserId: '70000000-0000-4000-8000-000000000011',
  }
  const replacementAuthority = {
    ...firstAuthority,
    characterLifecycleId: '70000000-0000-4000-8000-000000000016',
    managedMemberLifecycleId: '70000000-0000-4000-8000-000000000015',
    organizationVersion: 4,
    targetUserId: '70000000-0000-4000-8000-000000000014',
  }
  const firstIdentity = {
    sectionId: 'assets' as const,
    resourceId: 'assets' as const,
    operationContractRevision: 1,
    resourceRevision: 1,
    ...firstAuthority,
    observationId: '70000000-0000-4000-8000-000000000017',
  }
  const replacementIdentity = {
    ...firstIdentity,
    ...replacementAuthority,
    observationId: '70000000-0000-4000-8000-000000000018',
  }
  const firstValidatedAt = '2026-09-17T12:00:00Z'
  const replacementValidatedAt = '2026-09-17T11:00:00Z'

  for (const [identity, validatedAt, itemId] of [
    [firstIdentity, firstValidatedAt, 1],
    [replacementIdentity, replacementValidatedAt, 2],
  ] as const) {
    await expect(
      writeContinuation({
        ...identity,
        checkpoint: { complete: true },
        expectedRevision: 0,
        records: [
          {
            recordKind: 'asset',
            sourceId: `asset-${itemId}`,
            sourceTimestamp: validatedAt,
            evidence: { itemId },
            validatedAt,
          },
        ],
        updatedAt: validatedAt,
      }),
    ).resolves.toStrictEqual({ outcome: 'applied', revision: 1 })
    await expect(
      promoteObservation({
        ...identity,
        dtoRevision: 1,
        expectedRevision: 1,
        validatedAt,
      }),
    ).resolves.toStrictEqual({ outcome: 'applied' })
  }

  await expect(readAssets(firstAuthority)).resolves.toBeNull()
  await expect(readAssets(replacementAuthority)).resolves.toMatchObject({
    observationId: replacementIdentity.observationId,
    snapshot: { records: [{ itemId: 2 }] },
  })
})

test('replaces an incomplete continuation when its contract revision changes', async () => {
  const writeContinuation = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/write-evidence-continuation'],
    memberAuditInvoker(),
  )
  const readContinuation = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/read-evidence-continuation'],
    memberAuditInvoker({ readOnly: true }),
  )
  const promoteObservation = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/promote-evidence-observation'],
    memberAuditInvoker(),
  )
  const authority = {
    ...memberAuditAuthority,
    characterId: 90_000_108,
    characterLifecycleId: '70000000-0000-4000-8000-000000000032',
    managedMemberLifecycleId: '70000000-0000-4000-8000-000000000031',
    organizationVersion: 6,
    targetUserId: '70000000-0000-4000-8000-000000000030',
  }
  const staleIdentity = {
    sectionId: 'assets' as const,
    resourceId: 'assets' as const,
    operationContractRevision: 1,
    resourceRevision: 1,
    ...authority,
    observationId: '70000000-0000-4000-8000-000000000033',
  }
  const revisedIdentity = {
    ...staleIdentity,
    observationId: '70000000-0000-4000-8000-000000000034',
    operationContractRevision: 2,
  }
  const validatedAt = new Date(Date.now() - 60_000).toISOString()

  await expect(
    writeContinuation({
      ...staleIdentity,
      checkpoint: { page: 1 },
      expectedRevision: 0,
      records: [
        {
          recordKind: 'asset',
          sourceId: 'stale-asset',
          sourceTimestamp: validatedAt,
          evidence: { itemId: 1 },
          validatedAt,
        },
      ],
      updatedAt: validatedAt,
    }),
  ).resolves.toStrictEqual({ outcome: 'applied', revision: 1 })
  await expect(
    writeContinuation({
      ...revisedIdentity,
      checkpoint: { complete: true },
      expectedRevision: 0,
      records: [
        {
          recordKind: 'asset',
          sourceId: 'revised-asset',
          sourceTimestamp: validatedAt,
          evidence: { itemId: 2 },
          validatedAt,
        },
      ],
      updatedAt: validatedAt,
    }),
  ).resolves.toStrictEqual({ outcome: 'applied', revision: 1 })
  await expect(readContinuation(staleIdentity)).resolves.toBeNull()
  await expect(readContinuation(revisedIdentity)).resolves.toStrictEqual({
    checkpoint: { complete: true },
    revision: 1,
  })
  await expect(
    promoteObservation({
      ...staleIdentity,
      dtoRevision: 1,
      expectedRevision: 1,
      validatedAt,
    }),
  ).resolves.toStrictEqual({ outcome: 'obsolete' })
  await expect(
    promoteObservation({
      ...revisedIdentity,
      dtoRevision: 1,
      expectedRevision: 1,
      validatedAt,
    }),
  ).resolves.toStrictEqual({ outcome: 'applied' })

  const [staging] = await connection<{ staleRows: number }[]>`
    select count(*)::integer as "staleRows"
    from eve_module_member_audit.observation_staging
    where observation_id = ${staleIdentity.observationId}
  `
  expect(staging).toStrictEqual({ staleRows: 0 })
})

test('rejects mismatched promotions and future event timestamps before mutating evidence', async () => {
  const writeContinuation = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/write-evidence-continuation'],
    memberAuditInvoker(),
  )
  const promoteObservation = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/promote-evidence-observation'],
    memberAuditInvoker(),
  )
  const sourceTimestamp = new Date(Date.now() - 60_000).toISOString()
  const authority = {
    ...memberAuditAuthority,
    characterId: 90_000_105,
    characterLifecycleId: '70000000-0000-4000-8000-000000000021',
    managedMemberLifecycleId: '70000000-0000-4000-8000-000000000020',
    organizationVersion: 5,
    targetUserId: '70000000-0000-4000-8000-000000000019',
  }
  const identity = {
    sectionId: 'wallet' as const,
    resourceId: 'wallet-journal' as const,
    operationContractRevision: 1,
    resourceRevision: 1,
    ...authority,
    observationId: '70000000-0000-4000-8000-000000000022',
  }
  await connection`
    insert into eve_module_member_audit.wallet_journal_records (
      organization_version, target_user_id, managed_member_lifecycle_id, character_id,
      character_lifecycle_id, authorization_generation, disclosure_version,
      section_activation_version, dto_revision, source_id, source_timestamp, expires_at,
      evidence, validated_at
    ) values (
      ${authority.organizationVersion}, ${authority.targetUserId},
      ${authority.managedMemberLifecycleId}, ${authority.characterId},
      ${authority.characterLifecycleId}, ${authority.authorizationGeneration},
      ${authority.disclosureVersion}, ${authority.sectionActivationVersion}, 1,
      'existing', ${sourceTimestamp}, ${sourceTimestamp}::timestamptz + '90 days'::interval,
      ${connection.json({ amount: 1 })}, ${sourceTimestamp}
    )
  `
  await writeContinuation({
    ...identity,
    checkpoint: { complete: true },
    expectedRevision: 0,
    records: [
      {
        recordKind: 'wallet-journal',
        sourceId: 'replacement',
        sourceTimestamp,
        evidence: { amount: 2 },
        validatedAt: sourceTimestamp,
      },
    ],
    updatedAt: sourceTimestamp,
  })
  await expect(
    promoteObservation({
      ...identity,
      dtoRevision: 1,
      expectedRevision: 1,
      operationContractRevision: 2,
      validatedAt: sourceTimestamp,
    }),
  ).resolves.toStrictEqual({ outcome: 'obsolete' })

  const futureAuthority = {
    ...authority,
    characterId: 90_000_106,
    characterLifecycleId: '70000000-0000-4000-8000-000000000025',
    managedMemberLifecycleId: '70000000-0000-4000-8000-000000000024',
    targetUserId: '70000000-0000-4000-8000-000000000023',
  }
  const futureIdentity = {
    ...identity,
    ...futureAuthority,
    observationId: '70000000-0000-4000-8000-000000000026',
  }
  await connection`
    insert into eve_module_member_audit.wallet_journal_records (
      organization_version, target_user_id, managed_member_lifecycle_id, character_id,
      character_lifecycle_id, authorization_generation, disclosure_version,
      section_activation_version, dto_revision, source_id, source_timestamp, expires_at,
      evidence, validated_at
    ) values (
      ${futureAuthority.organizationVersion}, ${futureAuthority.targetUserId},
      ${futureAuthority.managedMemberLifecycleId}, ${futureAuthority.characterId},
      ${futureAuthority.characterLifecycleId}, ${futureAuthority.authorizationGeneration},
      ${futureAuthority.disclosureVersion}, ${futureAuthority.sectionActivationVersion}, 1,
      'existing-future-authority', ${sourceTimestamp},
      ${sourceTimestamp}::timestamptz + '90 days'::interval,
      ${connection.json({ amount: 3 })}, ${sourceTimestamp}
    )
  `
  await writeContinuation({
    ...futureIdentity,
    checkpoint: { complete: true },
    expectedRevision: 0,
    records: [
      {
        recordKind: 'wallet-journal',
        sourceId: 'future',
        sourceTimestamp: '2099-01-01T00:00:00Z',
        evidence: { amount: 4 },
        validatedAt: sourceTimestamp,
      },
    ],
    updatedAt: sourceTimestamp,
  })
  await expect(
    promoteObservation({
      ...futureIdentity,
      dtoRevision: 1,
      expectedRevision: 1,
      validatedAt: sourceTimestamp,
    }),
  ).resolves.toStrictEqual({ outcome: 'obsolete' })

  const rows = await connection<{ characterId: number; sourceId: string }[]>`
    select character_id::integer as "characterId", source_id as "sourceId"
    from eve_module_member_audit.wallet_journal_records
    where character_id in (${authority.characterId}, ${futureAuthority.characterId})
    order by character_id
  `
  expect([...rows]).toStrictEqual([
    { characterId: authority.characterId, sourceId: 'existing' },
    { characterId: futureAuthority.characterId, sourceId: 'existing-future-authority' },
  ])
})

test('derives mail detail retention from the matching retained header', async () => {
  const writeContinuation = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/write-evidence-continuation'],
    memberAuditInvoker(),
  )
  const promoteObservation = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/promote-evidence-observation'],
    memberAuditInvoker(),
  )
  const authority = {
    ...memberAuditAuthority,
    characterId: 90_000_109,
    characterLifecycleId: '70000000-0000-4000-8000-000000000037',
    managedMemberLifecycleId: '70000000-0000-4000-8000-000000000036',
    organizationVersion: 7,
    targetUserId: '70000000-0000-4000-8000-000000000035',
  }
  const identity = {
    sectionId: 'mail' as const,
    resourceId: 'mail-details' as const,
    operationContractRevision: 1,
    resourceRevision: 1,
    ...authority,
    observationId: '70000000-0000-4000-8000-000000000038',
  }
  const headerTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const collectorTimestamp = new Date().toISOString()
  await connection`
    insert into eve_module_member_audit.mail_headers (
      organization_version, target_user_id, managed_member_lifecycle_id, character_id,
      character_lifecycle_id, authorization_generation, disclosure_version,
      section_activation_version, dto_revision, source_id, source_timestamp, expires_at,
      evidence, validated_at
    ) values (
      ${authority.organizationVersion}, ${authority.targetUserId},
      ${authority.managedMemberLifecycleId}, ${authority.characterId},
      ${authority.characterLifecycleId}, ${authority.authorizationGeneration},
      ${authority.disclosureVersion}, ${authority.sectionActivationVersion}, 1,
      'message-1', ${headerTimestamp},
      ${headerTimestamp}::timestamptz + '90 days'::interval,
      ${connection.json({ subject: 'Retained header' })}, ${collectorTimestamp}
    )
  `
  await expect(
    writeContinuation({
      ...identity,
      checkpoint: { complete: true },
      expectedRevision: 0,
      records: [
        {
          recordKind: 'mail-content',
          sourceId: 'message-1',
          sourceTimestamp: collectorTimestamp,
          evidence: { body: 'Sanitized' },
          validatedAt: collectorTimestamp,
        },
      ],
      updatedAt: collectorTimestamp,
    }),
  ).resolves.toStrictEqual({ outcome: 'applied', revision: 1 })
  await expect(
    promoteObservation({
      ...identity,
      dtoRevision: 1,
      expectedRevision: 1,
      validatedAt: collectorTimestamp,
    }),
  ).resolves.toStrictEqual({ outcome: 'applied' })

  const [content] = await connection<{ expiresAt: Date; sourceTimestamp: Date }[]>`
    select source_timestamp as "sourceTimestamp", expires_at as "expiresAt"
    from eve_module_member_audit.mail_contents
    where character_id = ${authority.characterId} and source_id = 'message-1'
  `
  expect(content).toStrictEqual({
    expiresAt: new Date(new Date(headerTimestamp).getTime() + 90 * 24 * 60 * 60 * 1000),
    sourceTimestamp: new Date(headerTimestamp),
  })
})

test('rolls promotion back atomically with its enclosing collection transaction', async () => {
  const rollbackIdentity = {
    ...continuationIdentity,
    characterId: 90_000_103,
    characterLifecycleId: '7ddddddd-dddd-4ddd-8ddd-dddddddddddd',
    managedMemberLifecycleId: '7ccccccc-cccc-4ccc-8ccc-cccccccccccc',
    observationId: '76666666-6666-4666-8666-666666666666',
    organizationVersion: 2,
    targetUserId: '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  }
  const writeContinuation = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/write-evidence-continuation'],
    memberAuditInvoker(),
  )
  await writeContinuation({
    ...rollbackIdentity,
    checkpoint: { complete: true },
    expectedRevision: 0,
    records: [
      {
        recordKind: 'asset',
        sourceId: 'asset-rollback',
        sourceTimestamp: '2026-09-17T11:03:00Z',
        evidence: { itemId: 3 },
        validatedAt: '2026-09-17T11:03:00Z',
      },
    ],
    updatedAt: '2026-09-17T11:03:00Z',
  })

  await expect(
    connection.begin(async (transaction) => {
      const scoped = createTransactionScopedModulePersistenceOperationInvoker(
        transaction,
        'member-audit',
        installedModulePersistenceOperations,
      )
      await scoped.invoke(
        installedModulePersistenceOperationCatalog['member-audit/promote-evidence-observation'],
        {
          ...rollbackIdentity,
          dtoRevision: 1,
          expectedRevision: 1,
          validatedAt: '2026-09-17T11:03:00Z',
        },
      )
      scoped.close()
      throw new Error('roll back collection state update')
    }),
  ).rejects.toThrow('roll back collection state update')

  const [state] = await connection<
    { continuationCount: number; promotionCount: number; stagingCount: number }[]
  >`
    select
      (select count(*)::integer from eve_module_member_audit.collection_continuations
       where observation_id = ${rollbackIdentity.observationId}) as "continuationCount",
      (select count(*)::integer from eve_module_member_audit.observation_staging
       where observation_id = ${rollbackIdentity.observationId}) as "stagingCount",
      (select count(*)::integer from eve_module_member_audit.promoted_observations
       where observation_id = ${rollbackIdentity.observationId}) as "promotionCount"
  `
  expect(state).toStrictEqual({ continuationCount: 1, promotionCount: 0, stagingCount: 1 })
})

test('bounds retention and authority purges without retaining evidence through account deletion', async () => {
  const purgeEvidence = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/purge-evidence'],
    memberAuditInvoker(),
  )
  const expiredAt = new Date('2026-01-01T00:00:00Z')
  const sourceTimestamp = new Date('2025-10-03T00:00:00Z')
  await connection`
    insert into eve_module_member_audit.wallet_journal_records (
      organization_version, target_user_id, managed_member_lifecycle_id, character_id,
      character_lifecycle_id, authorization_generation, disclosure_version,
      section_activation_version, dto_revision, source_id, source_timestamp, expires_at,
      evidence, validated_at
    ) values
      (1, ${memberAuditAuthority.targetUserId}, ${memberAuditAuthority.managedMemberLifecycleId},
       ${memberAuditAuthority.characterId}, ${memberAuditAuthority.characterLifecycleId}, 1, 1, 1,
       1, 'expired-1', ${sourceTimestamp}, ${expiredAt}, ${connection.json({ amount: 1 })}, ${sourceTimestamp}),
      (1, ${memberAuditAuthority.targetUserId}, ${memberAuditAuthority.managedMemberLifecycleId},
       ${memberAuditAuthority.characterId}, ${memberAuditAuthority.characterLifecycleId}, 1, 1, 1,
       1, 'expired-2', ${sourceTimestamp}, ${expiredAt}, ${connection.json({ amount: 2 })}, ${sourceTimestamp})
  `
  const readWallet = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/read-wallet-evidence'],
    memberAuditInvoker({ readOnly: true }),
  )
  await expect(readWallet({ ...memberAuditAuthority, limit: 100 })).resolves.toMatchObject({
    journal: [],
  })
  await expect(
    purgeEvidence({
      cutoff: '2026-01-02T00:00:00Z',
      limit: 1,
      mode: 'retention',
      store: 'wallet-journal',
    }),
  ).resolves.toStrictEqual({ deleted: 1, remaining: true })
  await expect(
    purgeEvidence({
      cutoff: '2026-01-02T00:00:00Z',
      limit: 100,
      mode: 'retention',
      store: 'wallet-journal',
    }),
  ).resolves.toStrictEqual({ deleted: 1, remaining: false })

  const invalidAuthority = {
    ...memberAuditAuthority,
    characterId: 90_000_104,
    characterLifecycleId: '70000000-0000-4000-8000-000000000001',
    managedMemberLifecycleId: '7fffffff-ffff-4fff-8fff-ffffffffffff',
    targetUserId: '7eeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  }
  await connection`
    insert into eve_module_member_audit.wallet_balance_snapshots (
      organization_version, target_user_id, managed_member_lifecycle_id, character_id,
      character_lifecycle_id, authorization_generation, disclosure_version,
      section_activation_version, dto_revision, observation_id, snapshot, validated_at
    ) values (
      ${invalidAuthority.organizationVersion}, ${invalidAuthority.targetUserId},
      ${invalidAuthority.managedMemberLifecycleId}, ${invalidAuthority.characterId},
      ${invalidAuthority.characterLifecycleId}, ${invalidAuthority.authorizationGeneration},
      ${invalidAuthority.disclosureVersion}, ${invalidAuthority.sectionActivationVersion}, 1,
      '70000000-0000-4000-8000-000000000002',
      ${connection.json({ balance: 99, kind: 'wallet-balance' })}, now()
    )
  `
  await expect(
    readWallet({ ...invalidAuthority, authorizationGeneration: 2, limit: 100 }),
  ).resolves.toMatchObject({ balance: null })
  await expect(
    purgeEvidence({
      limit: 100,
      mode: 'authority',
      store: 'wallet-balance',
      ...invalidAuthority,
    }),
  ).resolves.toStrictEqual({ deleted: 1, remaining: false })

  await connection`
    insert into eve_module_member_audit.wallet_balance_snapshots (
      organization_version, target_user_id, managed_member_lifecycle_id, character_id,
      character_lifecycle_id, authorization_generation, disclosure_version,
      section_activation_version, dto_revision, observation_id, snapshot, validated_at
    ) values (
      9, '70000000-0000-4000-8000-000000000003',
      '70000000-0000-4000-8000-000000000004', 90000105,
      '70000000-0000-4000-8000-000000000005', 1, 1, 1, 1,
      '70000000-0000-4000-8000-000000000006',
      ${connection.json({ balance: 7, kind: 'wallet-balance' })}, now()
    )
  `
  await expect(
    purgeEvidence({
      limit: 100,
      mode: 'organization',
      organizationVersion: 9,
      store: 'wallet-balance',
    }),
  ).resolves.toStrictEqual({ deleted: 1, remaining: false })

  const userId = '77777777-7777-4777-8777-777777777777'
  await connection`insert into public.users (id) values (${userId})`
  const writeObservation = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/write-current-observation'],
    memberAuditInvoker(),
  )
  const purgeObservation = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/purge-current-observation'],
    memberAuditInvoker(),
  )
  const observationAuthority = {
    ...memberAuditAuthority,
    targetUserId: userId,
    characterId: 90_001_102,
  }
  const observedAt = new Date()
  const observationWrite = {
    ...observationAuthority,
    dtoRevision: 1 as const,
    validatedAt: observedAt.toISOString(),
    cachedUntil: new Date(observedAt.getTime() + 60_000).toISOString(),
  }
  await writeObservation({
    ...observationWrite,
    resourceId: 'current-ship',
    snapshot: {
      kind: 'current-ship',
      typeId: 34,
      typeName: 'Merlin',
      groupId: 25,
      groupName: 'Frigate',
      name: 'Current vessel',
    },
    observationId: randomUUID(),
  })
  await writeObservation({
    ...observationWrite,
    resourceId: 'current-location',
    snapshot: {
      kind: 'current-location',
      solarSystemId: 30_000_001,
      solarSystemName: 'System',
      solarSystemSecurityStatus: null,
      locationType: 'space',
    },
    observationId: randomUUID(),
  })
  await connection`
    insert into eve_module_member_audit.wallet_balance_snapshots (
      organization_version, target_user_id, managed_member_lifecycle_id, character_id,
      character_lifecycle_id, authorization_generation, disclosure_version,
      section_activation_version, dto_revision, observation_id, snapshot, validated_at
    ) values
      (
        1, ${userId}, '78888888-8888-4888-8888-888888888888', 90000102,
        '79999999-9999-4999-8999-999999999999', 1, 1, 1, 1,
        '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        ${connection.json({ balance: 42, kind: 'wallet-balance' })}, now()
      ),
      (
        2, ${userId}, '70000000-0000-4000-8000-000000000039', 90000110,
        '70000000-0000-4000-8000-000000000040', 1, 1, 1, 1,
        '70000000-0000-4000-8000-000000000041',
        ${connection.json({ balance: 84, kind: 'wallet-balance' })}, now()
      )
  `
  await expect(
    purgeEvidence({
      limit: 100,
      mode: 'account',
      store: 'wallet-balance',
      targetUserId: userId,
    }),
  ).resolves.toStrictEqual({ deleted: 2, remaining: false })
  for (const store of ['current-ship', 'current-location'] as const) {
    await expect(
      purgeObservation({ mode: 'account', store, targetUserId: userId, limit: 100 }),
    ).resolves.toStrictEqual({ deleted: 1, remaining: false })
  }
  await expect(connection`delete from public.users where id = ${userId}`).resolves.toBeDefined()
  const [retention] = await connection<
    { evidenceCount: number; observationCount: number; userCount: number }[]
  >`
    select
      (select count(*)::integer from public.users where id = ${userId}) as "userCount",
       (select count(*)::integer from eve_module_member_audit.wallet_balance_snapshots
        where target_user_id = ${userId}) as "evidenceCount",
       (select count(*)::integer from eve_module_member_audit.current_observation_snapshots
        where target_user_id = ${userId}) as "observationCount"
  `
  expect(retention).toStrictEqual({ evidenceCount: 0, observationCount: 0, userCount: 0 })
})

test('retains module evidence while module and section collection are disabled', async () => {
  await connection`
    update public.deployment_module_sections
    set enabled = false
    where module_id = 'member-audit' and section_id = 'assets'
  `
  await connection`
    update public.deployment_modules set enabled = false where module_id = 'member-audit'
  `
  const [state] = await connection<
    { evidenceCount: number; moduleEnabled: boolean; sectionEnabled: boolean }[]
  >`
    select
      (select enabled from public.deployment_modules where module_id = 'member-audit')
        as "moduleEnabled",
      (select enabled from public.deployment_module_sections
       where module_id = 'member-audit' and section_id = 'assets') as "sectionEnabled",
      (select count(*)::integer from eve_module_member_audit.asset_snapshots)
        as "evidenceCount"
  `
  expect(state).toStrictEqual({ evidenceCount: 3, moduleEnabled: false, sectionEnabled: false })
})

test('retains the disabled schema and evidence across static uninstall reconciliation', async () => {
  await runStartupMigrations(connection, {
    installed: [],
    moduleIds: [],
    persistenceContractFingerprint: persistenceContractFingerprintFor([], []),
    persistenceOperations: [],
  })
  const [retained] = await connection<
    { attested: boolean; evidenceCount: number; migrated: boolean; schemaExists: boolean }[]
  >`
    select
      exists (
        select from public.module_persistence_operation_attestations
        where module_id = 'member-audit'
      ) as attested,
      exists (
        select from public.schema_migrations
        where module = 'member-audit'
      ) as migrated,
      to_regnamespace('eve_module_member_audit') is not null as "schemaExists",
      (select count(*)::integer from eve_module_member_audit.asset_snapshots)
        as "evidenceCount"
  `
  expect(retained).toStrictEqual({
    attested: true,
    evidenceCount: 3,
    migrated: true,
    schemaExists: true,
  })
})
