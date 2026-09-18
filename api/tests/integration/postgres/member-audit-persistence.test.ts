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

let container: StartedTestContainer
let connection: postgres.Sql
let databaseUrl: string

const memberAuditAuthority = {
  organizationVersion: 1,
  targetUserId: '71111111-1111-4111-8111-111111111111',
  managedMemberLifecycleId: '72222222-2222-4222-8222-222222222222',
  characterId: 90_000_101,
  characterLifecycleId: '73333333-3333-4333-8333-333333333333',
  authorizationGeneration: 1,
  disclosureVersion: 1,
  sectionActivationVersion: 1,
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

test('migrates migration 001 skill evidence to RFC UUID observations accepted by readers', async () => {
  const databaseName = `member_audit_upgrade_${randomUUID().replaceAll('-', '')}`
  await connection`create database ${connection(databaseName)}`
  const upgradeUrl = new URL(databaseUrl)
  upgradeUrl.pathname = `/${databaseName}`
  const upgradeConnection = postgres(upgradeUrl.toString())
  const migration001 = [
    { moduleId: 'member-audit', name: 'member-audit-001-baseline.sql' },
  ] as const
  const migration001Operations = installedModulePersistenceOperations.filter(
    ({ moduleId, migration }) =>
      moduleId === 'member-audit' && migration === 'member-audit-001-baseline.sql',
  )

  try {
    await runStartupMigrations(upgradeConnection, {
      installed: migration001,
      moduleIds: ['member-audit'],
      persistenceOperations: migration001Operations,
      persistenceContractFingerprint: persistenceContractFingerprintFor(migration001Operations, [
        'member-audit',
      ]),
    })
    const writeLegacySnapshot = bindPlatformPersistenceOperation(
      installedModulePersistenceOperationCatalog['member-audit/write-skill-snapshot'],
      createStandaloneModulePersistenceOperationInvoker(
        upgradeConnection,
        'member-audit',
        migration001Operations,
      ),
    )
    const authority = {
      resourceId: 'trained-skills' as const,
      organizationVersion: 1,
      targetUserId: '11111111-1111-4111-8111-111111111111',
      managedMemberLifecycleId: '22222222-2222-4222-8222-222222222222',
      characterId: 90_000_009,
      characterLifecycleId: '33333333-3333-4333-8333-333333333333',
      authorizationGeneration: 1,
      disclosureVersion: 1,
      sectionActivationVersion: 1,
      dtoRevision: 1 as const,
      validatedAt: '2026-09-17T10:00:00Z',
      snapshot: {
        kind: 'trained-skills' as const,
        totalSp: 0,
        unallocatedSp: 0,
        injectedSkillCount: 0,
        groups: [],
      },
    }
    await expect(writeLegacySnapshot(authority)).resolves.toEqual({ outcome: 'applied' })

    await runStartupMigrations(upgradeConnection)
    const readSkillEvidence = bindPlatformPersistenceOperation(
      installedModulePersistenceOperationCatalog['member-audit/read-skill-evidence'],
      createStandaloneModulePersistenceOperationInvoker(
        upgradeConnection,
        'member-audit',
        installedModulePersistenceOperations,
        { readOnly: true },
      ),
    )

    await expect(
      readSkillEvidence({
        organizationVersion: authority.organizationVersion,
        targetUserId: authority.targetUserId,
        managedMemberLifecycleId: authority.managedMemberLifecycleId,
        characterId: authority.characterId,
        characterLifecycleId: authority.characterLifecycleId,
        authorizationGeneration: authority.authorizationGeneration,
        disclosureVersion: authority.disclosureVersion,
        sectionActivationVersion: authority.sectionActivationVersion,
      }),
    ).resolves.toMatchObject({
      trainedSkills: {
        observationId: expect.stringMatching(/^[0-9a-f]{8}-.{4}-4.{3}-8.{3}-.{12}$/),
      },
      skillQueue: null,
    })
  } finally {
    await upgradeConnection.end()
    await connection`drop database ${connection(databaseName)}`
  }
})

test('keeps migrated legacy skill storage empty and replaces snapshots across authority revisions', async () => {
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
    resourceId: 'skill-queue' as const,
    organizationVersion: 1,
    targetUserId: '11111111-1111-4111-8111-111111111111',
    managedMemberLifecycleId: '22222222-2222-4222-8222-222222222222',
    characterId: 90_000_001,
    characterLifecycleId: '33333333-3333-4333-8333-333333333333',
    authorizationGeneration: 1,
    disclosureVersion: 1,
    sectionActivationVersion: 1,
    observationId: '70000000-0000-4000-8000-000000000001',
    dtoRevision: 1,
    validatedAt: '2026-09-17T10:00:00Z',
    snapshot: { kind: 'skill-queue' as const, entries: [] },
  }
  const revisions = [
    {
      ...initial,
      authorizationGeneration: 2,
      observationId: '70000000-0000-4000-8000-000000000002',
      validatedAt: '2026-09-17T10:01:00Z',
    },
    {
      ...initial,
      authorizationGeneration: 2,
      managedMemberLifecycleId: '44444444-4444-4444-8444-444444444444',
      observationId: '70000000-0000-4000-8000-000000000003',
      validatedAt: '2026-09-17T10:02:00Z',
    },
    {
      ...initial,
      authorizationGeneration: 2,
      managedMemberLifecycleId: '44444444-4444-4444-8444-444444444444',
      characterLifecycleId: '55555555-5555-4555-8555-555555555555',
      observationId: '70000000-0000-4000-8000-000000000004',
      validatedAt: '2026-09-17T10:03:00Z',
    },
    {
      ...initial,
      authorizationGeneration: 2,
      managedMemberLifecycleId: '44444444-4444-4444-8444-444444444444',
      characterLifecycleId: '55555555-5555-4555-8555-555555555555',
      disclosureVersion: 2,
      observationId: '70000000-0000-4000-8000-000000000005',
      validatedAt: '2026-09-17T10:04:00Z',
    },
    {
      ...initial,
      authorizationGeneration: 2,
      managedMemberLifecycleId: '44444444-4444-4444-8444-444444444444',
      characterLifecycleId: '55555555-5555-4555-8555-555555555555',
      disclosureVersion: 2,
      sectionActivationVersion: 2,
      observationId: '70000000-0000-4000-8000-000000000006',
      validatedAt: '2026-09-17T10:05:00Z',
    },
    {
      ...initial,
      organizationVersion: 2,
      authorizationGeneration: 2,
      managedMemberLifecycleId: '44444444-4444-4444-8444-444444444444',
      characterLifecycleId: '55555555-5555-4555-8555-555555555555',
      disclosureVersion: 2,
      sectionActivationVersion: 2,
      observationId: '70000000-0000-4000-8000-000000000007',
      validatedAt: '2026-09-17T10:06:00Z',
    },
    {
      ...initial,
      organizationVersion: 2,
      targetUserId: '66666666-6666-4666-8666-666666666666',
      authorizationGeneration: 2,
      managedMemberLifecycleId: '44444444-4444-4444-8444-444444444444',
      characterLifecycleId: '55555555-5555-4555-8555-555555555555',
      disclosureVersion: 2,
      sectionActivationVersion: 2,
      observationId: '70000000-0000-4000-8000-000000000008',
      validatedAt: '2026-09-17T10:07:00Z',
    },
  ]

  await expect(materializeCurrentSnapshot(initial)).resolves.toEqual({ outcome: 'applied' })
  for (const revision of revisions)
    await expect(materializeCurrentSnapshot(revision)).resolves.toEqual({ outcome: 'applied' })

  await expect(
    materializeCurrentSnapshot({
      ...initial,
      observationId: '70000000-0000-4000-8000-000000000009',
      validatedAt: '2026-09-17T09:59:00Z',
    }),
  ).resolves.toEqual({ outcome: 'obsolete' })

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
    from eve_module_member_audit.skill_queue_snapshots
    where character_id = 90000001
  `
  expect(snapshots).toEqual([
    {
      count: 1,
      organizationVersion: 2,
      targetUserId: '66666666-6666-4666-8666-666666666666',
      managedMemberLifecycleId: '44444444-4444-4444-8444-444444444444',
      characterLifecycleId: '55555555-5555-4555-8555-555555555555',
      authorizationGeneration: 2,
      disclosureVersion: 2,
      sectionActivationVersion: 2,
      validatedAt: new Date('2026-09-17T10:07:00Z'),
    },
  ])
  const [legacy] = await connection<
    { legacyRows: number; routine: string | null; table: string | null }[]
  >`
    select
      to_regprocedure('eve_module_member_audit.persist_write_skill_snapshot(jsonb)')::text as routine,
      to_regclass('eve_module_member_audit.skill_snapshots')::text as table,
      (select count(*)::integer from eve_module_member_audit.skill_snapshots) as "legacyRows"
  `
  expect(legacy).toEqual({
    legacyRows: 0,
    routine: 'eve_module_member_audit.persist_write_skill_snapshot(jsonb)',
    table: 'eve_module_member_audit.skill_snapshots',
  })
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

  expect(state).toEqual({
    attestationCount: 10,
    migrationCount: 4,
    moduleTableAccess: false,
    publicTableAccess: false,
    routineAccess: true,
  })
  expect(
    installedModulePersistenceOperationCatalog['member-audit/read-asset-evidence'].grants,
  ).toEqual({
    routes: ['assets-detail'],
    activityProviders: [],
    resourceProjections: [],
    resourceMaterializations: [],
  })
  expect(
    installedModulePersistenceOperationCatalog['member-audit/write-skill-snapshot'].grants,
  ).toEqual({
    routes: [],
    activityProviders: [],
    resourceProjections: [],
    resourceMaterializations: [],
  })
  expect(
    installedModulePersistenceOperationCatalog['member-audit/write-evidence-continuation'].grants
      .routes,
  ).toEqual([])
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
      expectedRevision: 0,
      checkpoint: { page: 1 },
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
  ).resolves.toEqual({ outcome: 'applied', revision: 1 })
  await expect(readContinuation(continuationIdentity)).resolves.toEqual({
    revision: 1,
    checkpoint: { page: 1 },
  })
  await expect(readAssets(memberAuditAuthority)).resolves.toBeNull()
  const incompletePromotion = {
    ...continuationIdentity,
    expectedRevision: 1,
    dtoRevision: 1,
    validatedAt,
  }
  await expect(promoteObservation(incompletePromotion)).resolves.toEqual({
    outcome: 'obsolete',
  })
  await expect(readAssets(memberAuditAuthority)).resolves.toBeNull()
  await expect(
    writeContinuation({
      ...continuationIdentity,
      expectedRevision: 0,
      checkpoint: { page: 2 },
      records: [],
      updatedAt: '2026-09-17T11:01:00Z',
    }),
  ).resolves.toEqual({ outcome: 'obsolete' })
  await expect(
    writeContinuation({
      ...continuationIdentity,
      expectedRevision: 1,
      checkpoint: { complete: 'true' },
      records: [],
      updatedAt: '2026-09-17T11:01:00Z',
    }),
  ).resolves.toEqual({ outcome: 'applied', revision: 2 })
  await expect(
    promoteObservation({
      ...continuationIdentity,
      expectedRevision: 2,
      dtoRevision: 1,
      validatedAt,
    }),
  ).resolves.toEqual({ outcome: 'obsolete' })
  await expect(
    writeContinuation({
      ...continuationIdentity,
      expectedRevision: 2,
      checkpoint: { complete: true },
      records: [],
      updatedAt: '2026-09-17T11:01:00Z',
    }),
  ).resolves.toEqual({ outcome: 'applied', revision: 3 })

  const promotion = {
    ...continuationIdentity,
    expectedRevision: 3,
    dtoRevision: 1,
    validatedAt,
  }
  await expect(promoteObservation(promotion)).resolves.toEqual({ outcome: 'applied' })
  await expect(promoteObservation(promotion)).resolves.toEqual({ outcome: 'applied' })
  await expect(
    writeContinuation({
      ...continuationIdentity,
      expectedRevision: 0,
      checkpoint: { page: 2 },
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
  ).resolves.toEqual({ outcome: 'obsolete' })
  await expect(
    writeContinuation({
      ...continuationIdentity,
      observationId: '70000000-0000-4000-8000-000000000010',
      expectedRevision: 1,
      checkpoint: { page: 2 },
      records: [],
      updatedAt: validatedAt,
    }),
  ).resolves.toEqual({ outcome: 'obsolete' })
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
    expectedRevision: 0,
    checkpoint: { page: 1 },
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
    organizationVersion: 3,
    targetUserId: '70000000-0000-4000-8000-000000000011',
    managedMemberLifecycleId: '70000000-0000-4000-8000-000000000012',
    characterId: 90_000_104,
    characterLifecycleId: '70000000-0000-4000-8000-000000000013',
  }
  const replacementAuthority = {
    ...firstAuthority,
    organizationVersion: 4,
    targetUserId: '70000000-0000-4000-8000-000000000014',
    managedMemberLifecycleId: '70000000-0000-4000-8000-000000000015',
    characterLifecycleId: '70000000-0000-4000-8000-000000000016',
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
        expectedRevision: 0,
        checkpoint: { complete: true },
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
    ).resolves.toEqual({ outcome: 'applied', revision: 1 })
    await expect(
      promoteObservation({
        ...identity,
        expectedRevision: 1,
        dtoRevision: 1,
        validatedAt,
      }),
    ).resolves.toEqual({ outcome: 'applied' })
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
    organizationVersion: 6,
    targetUserId: '70000000-0000-4000-8000-000000000030',
    managedMemberLifecycleId: '70000000-0000-4000-8000-000000000031',
    characterId: 90_000_108,
    characterLifecycleId: '70000000-0000-4000-8000-000000000032',
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
    operationContractRevision: 2,
    observationId: '70000000-0000-4000-8000-000000000034',
  }
  const validatedAt = new Date(Date.now() - 60_000).toISOString()

  await expect(
    writeContinuation({
      ...staleIdentity,
      expectedRevision: 0,
      checkpoint: { page: 1 },
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
  ).resolves.toEqual({ outcome: 'applied', revision: 1 })
  await expect(
    writeContinuation({
      ...revisedIdentity,
      expectedRevision: 0,
      checkpoint: { complete: true },
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
  ).resolves.toEqual({ outcome: 'applied', revision: 1 })
  await expect(readContinuation(staleIdentity)).resolves.toBeNull()
  await expect(readContinuation(revisedIdentity)).resolves.toEqual({
    revision: 1,
    checkpoint: { complete: true },
  })
  await expect(
    promoteObservation({
      ...staleIdentity,
      expectedRevision: 1,
      dtoRevision: 1,
      validatedAt,
    }),
  ).resolves.toEqual({ outcome: 'obsolete' })
  await expect(
    promoteObservation({
      ...revisedIdentity,
      expectedRevision: 1,
      dtoRevision: 1,
      validatedAt,
    }),
  ).resolves.toEqual({ outcome: 'applied' })

  const [staging] = await connection<{ staleRows: number }[]>`
    select count(*)::integer as "staleRows"
    from eve_module_member_audit.observation_staging
    where observation_id = ${staleIdentity.observationId}
  `
  expect(staging).toEqual({ staleRows: 0 })
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
    organizationVersion: 5,
    targetUserId: '70000000-0000-4000-8000-000000000019',
    managedMemberLifecycleId: '70000000-0000-4000-8000-000000000020',
    characterId: 90_000_105,
    characterLifecycleId: '70000000-0000-4000-8000-000000000021',
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
    expectedRevision: 0,
    checkpoint: { complete: true },
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
      operationContractRevision: 2,
      expectedRevision: 1,
      dtoRevision: 1,
      validatedAt: sourceTimestamp,
    }),
  ).resolves.toEqual({ outcome: 'obsolete' })

  const futureAuthority = {
    ...authority,
    targetUserId: '70000000-0000-4000-8000-000000000023',
    managedMemberLifecycleId: '70000000-0000-4000-8000-000000000024',
    characterId: 90_000_106,
    characterLifecycleId: '70000000-0000-4000-8000-000000000025',
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
    expectedRevision: 0,
    checkpoint: { complete: true },
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
      expectedRevision: 1,
      dtoRevision: 1,
      validatedAt: sourceTimestamp,
    }),
  ).resolves.toEqual({ outcome: 'obsolete' })

  const rows = await connection<{ characterId: number; sourceId: string }[]>`
    select character_id::integer as "characterId", source_id as "sourceId"
    from eve_module_member_audit.wallet_journal_records
    where character_id in (${authority.characterId}, ${futureAuthority.characterId})
    order by character_id
  `
  expect(rows).toEqual([
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
    organizationVersion: 7,
    targetUserId: '70000000-0000-4000-8000-000000000035',
    managedMemberLifecycleId: '70000000-0000-4000-8000-000000000036',
    characterId: 90_000_109,
    characterLifecycleId: '70000000-0000-4000-8000-000000000037',
  }
  const identity = {
    sectionId: 'mail' as const,
    resourceId: 'mail-details' as const,
    operationContractRevision: 1,
    resourceRevision: 1,
    ...authority,
    observationId: '70000000-0000-4000-8000-000000000038',
  }
  const headerTimestamp = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString()
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
      expectedRevision: 0,
      checkpoint: { complete: true },
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
  ).resolves.toEqual({ outcome: 'applied', revision: 1 })
  await expect(
    promoteObservation({
      ...identity,
      expectedRevision: 1,
      dtoRevision: 1,
      validatedAt: collectorTimestamp,
    }),
  ).resolves.toEqual({ outcome: 'applied' })

  const [content] = await connection<{ expiresAt: Date; sourceTimestamp: Date }[]>`
    select source_timestamp as "sourceTimestamp", expires_at as "expiresAt"
    from eve_module_member_audit.mail_contents
    where character_id = ${authority.characterId} and source_id = 'message-1'
  `
  expect(content).toEqual({
    sourceTimestamp: new Date(headerTimestamp),
    expiresAt: new Date(new Date(headerTimestamp).getTime() + 90 * 24 * 60 * 60 * 1_000),
  })
})

test('rolls promotion back atomically with its enclosing collection transaction', async () => {
  const rollbackIdentity = {
    ...continuationIdentity,
    organizationVersion: 2,
    targetUserId: '7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    managedMemberLifecycleId: '7ccccccc-cccc-4ccc-8ccc-cccccccccccc',
    characterId: 90_000_103,
    characterLifecycleId: '7ddddddd-dddd-4ddd-8ddd-dddddddddddd',
    observationId: '76666666-6666-4666-8666-666666666666',
  }
  const writeContinuation = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/write-evidence-continuation'],
    memberAuditInvoker(),
  )
  await writeContinuation({
    ...rollbackIdentity,
    expectedRevision: 0,
    checkpoint: { complete: true },
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
          expectedRevision: 1,
          dtoRevision: 1,
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
  expect(state).toEqual({ continuationCount: 1, stagingCount: 1, promotionCount: 0 })
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
      mode: 'retention',
      store: 'wallet-journal',
      cutoff: '2026-01-02T00:00:00Z',
      limit: 1,
    }),
  ).resolves.toEqual({ deleted: 1, remaining: true })
  await expect(
    purgeEvidence({
      mode: 'retention',
      store: 'wallet-journal',
      cutoff: '2026-01-02T00:00:00Z',
      limit: 100,
    }),
  ).resolves.toEqual({ deleted: 1, remaining: false })

  const writeLegacySkillSnapshot = bindPlatformPersistenceOperation(
    installedModulePersistenceOperationCatalog['member-audit/write-skill-snapshot'],
    memberAuditInvoker(),
  )
  const legacyAuthority = {
    organizationVersion: 10,
    targetUserId: '70000000-0000-4000-8000-000000000027',
    managedMemberLifecycleId: '70000000-0000-4000-8000-000000000028',
    characterId: 90_000_107,
    characterLifecycleId: '70000000-0000-4000-8000-000000000029',
    authorizationGeneration: 1,
    disclosureVersion: 1,
    sectionActivationVersion: 1,
  }
  await expect(
    writeLegacySkillSnapshot({
      resourceId: 'skill-queue',
      ...legacyAuthority,
      dtoRevision: 1,
      snapshot: { kind: 'skill-queue', entries: [] },
      validatedAt: '2026-09-17T10:00:00Z',
    }),
  ).resolves.toEqual({ outcome: 'applied' })
  await expect(
    purgeEvidence({
      mode: 'account',
      store: 'legacy-skills',
      targetUserId: legacyAuthority.targetUserId,
      limit: 100,
    }),
  ).resolves.toEqual({ deleted: 1, remaining: false })

  const invalidAuthority = {
    ...memberAuditAuthority,
    targetUserId: '7eeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    managedMemberLifecycleId: '7fffffff-ffff-4fff-8fff-ffffffffffff',
    characterId: 90_000_104,
    characterLifecycleId: '70000000-0000-4000-8000-000000000001',
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
      ${connection.json({ kind: 'wallet-balance', balance: 99 })}, now()
    )
  `
  await expect(
    readWallet({ ...invalidAuthority, authorizationGeneration: 2, limit: 100 }),
  ).resolves.toMatchObject({ balance: null })
  await expect(
    purgeEvidence({
      mode: 'authority',
      store: 'wallet-balance',
      limit: 100,
      ...invalidAuthority,
    }),
  ).resolves.toEqual({ deleted: 1, remaining: false })

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
      ${connection.json({ kind: 'wallet-balance', balance: 7 })}, now()
    )
  `
  await expect(
    purgeEvidence({
      mode: 'organization',
      store: 'wallet-balance',
      organizationVersion: 9,
      limit: 100,
    }),
  ).resolves.toEqual({ deleted: 1, remaining: false })

  const userId = '77777777-7777-4777-8777-777777777777'
  await connection`insert into public.users (id) values (${userId})`
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
        ${connection.json({ kind: 'wallet-balance', balance: 42 })}, now()
      ),
      (
        2, ${userId}, '70000000-0000-4000-8000-000000000039', 90000110,
        '70000000-0000-4000-8000-000000000040', 1, 1, 1, 1,
        '70000000-0000-4000-8000-000000000041',
        ${connection.json({ kind: 'wallet-balance', balance: 84 })}, now()
      )
  `
  await expect(
    purgeEvidence({
      mode: 'account',
      store: 'wallet-balance',
      targetUserId: userId,
      limit: 100,
    }),
  ).resolves.toEqual({ deleted: 2, remaining: false })
  await expect(connection`delete from public.users where id = ${userId}`).resolves.toBeDefined()
  const [retention] = await connection<{ evidenceCount: number; userCount: number }[]>`
    select
      (select count(*)::integer from public.users where id = ${userId}) as "userCount",
      (select count(*)::integer from eve_module_member_audit.wallet_balance_snapshots
       where target_user_id = ${userId}) as "evidenceCount"
  `
  expect(retention).toEqual({ userCount: 0, evidenceCount: 0 })
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
  expect(state).toEqual({ moduleEnabled: false, sectionEnabled: false, evidenceCount: 3 })
})

test('retains the disabled schema and evidence across static uninstall reconciliation', async () => {
  await runStartupMigrations(connection, {
    installed: [],
    moduleIds: [],
    persistenceOperations: [],
    persistenceContractFingerprint: persistenceContractFingerprintFor([], []),
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
  expect(retained).toEqual({
    attested: true,
    migrated: true,
    schemaExists: true,
    evidenceCount: 3,
  })
})
