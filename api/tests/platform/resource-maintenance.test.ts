import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract/resources'
import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createPersistence: vi.fn(() => ({ purgeEvidence: vi.fn() })),
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

vi.mock('../../src/platform/module-persistence-capabilities.js', () => ({
  createPlatformResourceMaintenancePersistence: mocks.createPersistence,
}))
vi.mock('../../src/platform/module-logging.js', () => ({
  createPlatformModuleLogger: vi.fn(() => mocks.logger),
}))

import { runInstalledResourceMaintenance } from '../../src/platform/resource-maintenance.js'

beforeEach(() => {
  vi.clearAllMocks()
})

test('runs retention cleanup while the Market module is disabled without pending purge work', async () => {
  const maintain = vi.fn()
  const resource = {
    eligibility: { kind: 'current-deployment' },
    implementation: { maintain },
    materializationIntervalSeconds: 60,
    moduleId: 'market',
    operationId: 'market-region-orders',
    resourceId: 'orders',
    scheduled: false,
    profileKeyed: true,
    subjectKind: 'deployment',
  } as const satisfies PlatformInstalledResourceDescriptor
  const connection = vi.fn().mockResolvedValue([])
  await expect(
    runInstalledResourceMaintenance({
      // SAFETY: Maintenance only uses the SQL tag, which this mock supplies.
      connection: connection as never,
      resources: [resource],
    }),
  ).resolves.toStrictEqual({ maintained: 1 })
  expect(maintain).toHaveBeenCalledOnce()
  expect(maintain).toHaveBeenCalledWith(
    expect.objectContaining({
      purgeAccountIds: [],
      invalidAuthorities: [],
      purgeRetention: true,
    }),
  )
  expect(mocks.createPersistence).toHaveBeenCalledWith('market', 'orders', undefined)
})

test('runs maintenance for disabled non-scheduled resources with invalid authority context', async () => {
  const maintain = vi.fn()
  const connection = vi.fn().mockResolvedValue([
    {
      authorizationGeneration: 4,
      characterId: 90_000_001,
      characterLifecycleId: '33333333-3333-4333-8333-333333333333',
      disclosureVersion: 2,
      managedMemberLifecycleId: '22222222-2222-4222-8222-222222222222',
      organizationVersion: 2,
      sectionActivationVersion: 3,
      targetUserId: '11111111-1111-4111-8111-111111111111',
    },
  ])
  const resource = {
    eligibility: { kind: 'current-managed-member-character' },
    implementation: { maintain },
    materializationIntervalSeconds: 900,
    moduleId: 'member-audit',
    operationId: 'wallet-balance',
    resourceId: 'wallet-balance',
    scheduled: false,
    sectionId: 'wallet',
    subjectKind: 'character',
  } satisfies PlatformInstalledResourceDescriptor

  await expect(
    runInstalledResourceMaintenance({
      // SAFETY: Maintenance only uses the SQL tag, which this mock supplies.
      connection: connection as never,
      now: new Date('2026-09-18T10:00:00Z'),
      resources: [resource],
    }),
  ).resolves.toStrictEqual({ maintained: 1 })

  expect(maintain).toHaveBeenCalledWith(
    expect.objectContaining({
      capabilities: {
        logger: mocks.logger,
        persistence: expect.any(Object),
      },
      invalidAuthorities: [expect.objectContaining({ characterId: 90_000_001 })],
      now: '2026-09-18T10:00:00.000Z',
      purgeAccountIds: [],
      purgeRetention: true,
    }),
  )
  expect(mocks.createPersistence).toHaveBeenCalledWith('member-audit', 'wallet-balance', undefined)
})

test('consumes durable purge work regardless of module enablement', async () => {
  const maintain = vi.fn()
  const connection = vi.fn((strings: TemplateStringsArray) => {
    const statement = strings.join(' ')
    if (statement.includes('from platform_resource_purge_work')) {
      return Promise.resolve([
        {
          mode: 'account',
          moduleId: 'member-audit',
          purgeWorkId: '11111111-1111-4111-8111-111111111111',
          resourceId: 'trained-skills',
          targetUserId: '22222222-2222-4222-8222-222222222222',
        },
        {
          authorizationGeneration: 4,
          characterId: 90_000_001,
          characterLifecycleId: '55555555-5555-4555-8555-555555555555',
          disclosureVersion: 2,
          managedMemberLifecycleId: '44444444-4444-4444-8444-444444444444',
          mode: 'authority',
          moduleId: 'member-audit',
          organizationVersion: 2,
          purgeWorkId: '33333333-3333-4333-8333-333333333333',
          resourceId: 'trained-skills',
          sectionActivationVersion: 3,
          targetUserId: '22222222-2222-4222-8222-222222222222',
        },
      ])
    }
    return Promise.resolve([])
  })
  const resource = {
    eligibility: { kind: 'current-managed-member-character' },
    implementation: { maintain },
    materializationIntervalSeconds: 900,
    moduleId: 'member-audit',
    operationId: 'skills',
    resourceId: 'trained-skills',
    sectionId: 'skills',
    subjectKind: 'character',
  } satisfies PlatformInstalledResourceDescriptor

  // SAFETY: The mocked connection implements only the SQL tag exercised by this maintenance test.
  await runInstalledResourceMaintenance({
    connection: connection as never,
    resources: [resource],
  })

  expect(maintain).toHaveBeenCalledWith(
    expect.objectContaining({
      invalidAuthorities: [expect.objectContaining({ characterId: 90_000_001 })],
      purgeAccountIds: ['22222222-2222-4222-8222-222222222222'],
      purgeRetention: true,
    }),
  )
  expect(
    connection.mock.calls.filter(([strings]) =>
      strings.join(' ').includes('delete from platform_resource_purge_work'),
    ),
  ).toHaveLength(2)
})

test('retains durable purge work when disabled-module maintenance fails', async () => {
  const failure = new Error('Purge failed')
  const maintain = vi.fn().mockRejectedValue(failure)
  const connection = vi.fn((strings: TemplateStringsArray) => {
    if (!strings.join(' ').includes('from platform_resource_purge_work')) {
      return Promise.resolve([])
    }
    return Promise.resolve([
      {
        mode: 'account',
        moduleId: 'member-audit',
        purgeWorkId: '11111111-1111-4111-8111-111111111111',
        resourceId: 'trained-skills',
        targetUserId: '22222222-2222-4222-8222-222222222222',
      },
    ])
  })
  const resource = {
    eligibility: { kind: 'current-managed-member-character' },
    implementation: { maintain },
    materializationIntervalSeconds: 900,
    moduleId: 'member-audit',
    operationId: 'skills',
    resourceId: 'trained-skills',
    sectionId: 'skills',
    subjectKind: 'character',
  } satisfies PlatformInstalledResourceDescriptor

  // SAFETY: The mocked connection implements only the SQL tag exercised by this maintenance test.
  await expect(
    runInstalledResourceMaintenance({
      connection: connection as never,
      resources: [resource],
    }),
  ).rejects.toBe(failure)
  expect(maintain).toHaveBeenCalledOnce()
  expect(
    connection.mock.calls.some(([strings]) =>
      strings.join(' ').includes('delete from platform_resource_purge_work'),
    ),
  ).toBe(false)
})

test('drains invalid-authority pages beyond the first thousand before completing maintenance', async () => {
  const maintain = vi.fn().mockResolvedValue(undefined)
  const authority = {
    authorizationGeneration: 4,
    characterId: 90_000_001,
    characterLifecycleId: '33333333-3333-4333-8333-333333333333',
    disclosureVersion: 2,
    managedMemberLifecycleId: '22222222-2222-4222-8222-222222222222',
    organizationVersion: 2,
    sectionActivationVersion: 3,
    targetUserId: '11111111-1111-4111-8111-111111111111',
  }
  const connection = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = strings.join(' ')
    if (!statement.includes('from platform_collection_state')) return Promise.resolve([])
    return Promise.resolve(
      values.at(-1) === 0 ? Array.from({ length: 1000 }, () => authority) : [authority],
    )
  })
  const resource = {
    eligibility: { kind: 'current-managed-member-character' },
    implementation: { maintain },
    materializationIntervalSeconds: 300,
    moduleId: 'member-audit',
    operationId: 'ship',
    resourceId: 'current-ship',
    sectionId: 'current-observation',
    subjectKind: 'character',
  } satisfies PlatformInstalledResourceDescriptor

  // SAFETY: The mock returns bounded PostgreSQL-tag pages for the maintenance query.
  await runInstalledResourceMaintenance({
    connection: connection as never,
    resources: [resource],
  })

  expect(maintain).toHaveBeenCalledTimes(2)
  expect(maintain.mock.calls[0]?.[0].invalidAuthorities).toHaveLength(1000)
  expect(maintain.mock.calls[1]?.[0]).toMatchObject({
    invalidAuthorities: [authority],
    purgeAccountIds: [],
    purgeRetention: false,
  })
})
