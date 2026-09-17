import { randomUUID } from 'node:crypto'
import { bindPlatformPersistenceOperation } from '@eve-space/platform-module-server'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createStandaloneModulePersistenceOperationInvoker } from '../../../src/db/module-persistence-operation-transaction.js'
import { runStartupMigrations } from '../../../src/db/startup-migrations.js'
import {
  installedModulePersistenceOperationCatalog,
  installedModulePersistenceOperations,
} from '../../../src/generated/platform/installed-module-persistence.js'

let container: StartedTestContainer
let connection: postgres.Sql

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
  connection = postgres(
    `postgres://eve_space:${password}@${container.getHost()}:${container.getMappedPort(5432)}/eve_space`,
  )
  await runStartupMigrations(connection)
})

afterAll(async () => {
  await connection?.end()
  await container?.stop()
})

test('replaces superseded private skill snapshots across every authority revision', async () => {
  const operation = installedModulePersistenceOperationCatalog['member-audit/write-skill-snapshot']
  const writeSkillSnapshot = bindPlatformPersistenceOperation(
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
    dtoRevision: 1 as const,
    validatedAt: '2026-09-17T10:00:00Z',
    snapshot: { kind: 'skill-queue' as const, entries: [] },
  }
  const revisions = [
    { ...initial, authorizationGeneration: 2, validatedAt: '2026-09-17T10:01:00Z' },
    {
      ...initial,
      authorizationGeneration: 2,
      managedMemberLifecycleId: '44444444-4444-4444-8444-444444444444',
      validatedAt: '2026-09-17T10:02:00Z',
    },
    {
      ...initial,
      authorizationGeneration: 2,
      managedMemberLifecycleId: '44444444-4444-4444-8444-444444444444',
      characterLifecycleId: '55555555-5555-4555-8555-555555555555',
      validatedAt: '2026-09-17T10:03:00Z',
    },
    {
      ...initial,
      authorizationGeneration: 2,
      managedMemberLifecycleId: '44444444-4444-4444-8444-444444444444',
      characterLifecycleId: '55555555-5555-4555-8555-555555555555',
      disclosureVersion: 2,
      validatedAt: '2026-09-17T10:04:00Z',
    },
    {
      ...initial,
      authorizationGeneration: 2,
      managedMemberLifecycleId: '44444444-4444-4444-8444-444444444444',
      characterLifecycleId: '55555555-5555-4555-8555-555555555555',
      disclosureVersion: 2,
      sectionActivationVersion: 2,
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
      validatedAt: '2026-09-17T10:07:00Z',
    },
  ]

  await expect(writeSkillSnapshot(initial)).resolves.toEqual({ outcome: 'applied' })
  for (const revision of revisions)
    await expect(writeSkillSnapshot(revision)).resolves.toEqual({ outcome: 'applied' })

  await expect(
    writeSkillSnapshot({ ...initial, validatedAt: '2026-09-17T09:59:00Z' }),
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
    from eve_module_member_audit.skill_snapshots
    where resource_id = 'skill-queue' and character_id = 90000001
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
})
