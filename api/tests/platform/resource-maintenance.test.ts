import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract/resources'
import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createPersistence: vi.fn(() => ({ purgeEvidence: vi.fn() })),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../../src/platform/module-persistence-capabilities.js', () => ({
  createPlatformResourceMaintenancePersistence: mocks.createPersistence,
}))
vi.mock('../../src/platform/module-logging.js', () => ({
  createPlatformModuleLogger: vi.fn(() => mocks.logger),
}))

import { runInstalledResourceMaintenance } from '../../src/platform/resource-maintenance.js'

beforeEach(() => vi.clearAllMocks())

test('runs maintenance for non-scheduled resources with invalid authority context', async () => {
  const maintain = vi.fn()
  const connection = vi.fn().mockResolvedValue([
    {
      organizationVersion: 2,
      targetUserId: '11111111-1111-4111-8111-111111111111',
      managedMemberLifecycleId: '22222222-2222-4222-8222-222222222222',
      characterId: 90_000_001,
      characterLifecycleId: '33333333-3333-4333-8333-333333333333',
      authorizationGeneration: 4,
      disclosureVersion: 2,
      sectionActivationVersion: 3,
    },
  ])
  const resource = {
    moduleId: 'member-audit',
    resourceId: 'wallet-balance',
    operationId: 'wallet-balance',
    sectionId: 'wallet',
    scheduled: false,
    subjectKind: 'character',
    materializationIntervalSeconds: 900,
    eligibility: { kind: 'current-managed-member-character' },
    implementation: { maintain },
  } as unknown as PlatformInstalledResourceDescriptor

  await expect(
    runInstalledResourceMaintenance({
      connection: connection as never,
      now: new Date('2026-09-18T10:00:00Z'),
      resources: [resource],
    }),
  ).resolves.toEqual({ maintained: 1 })

  expect(maintain).toHaveBeenCalledWith(
    expect.objectContaining({
      now: '2026-09-18T10:00:00.000Z',
      purgeAccountIds: [],
      invalidAuthorities: [expect.objectContaining({ characterId: 90_000_001 })],
      purgeRetention: true,
      capabilities: {
        logger: mocks.logger,
        persistence: expect.any(Object),
      },
    }),
  )
  expect(mocks.createPersistence).toHaveBeenCalledWith('member-audit', 'wallet-balance', undefined)
})

test('consumes durable account and lifecycle purge work after maintenance succeeds', async () => {
  const maintain = vi.fn()
  const connection = vi.fn((strings: TemplateStringsArray) => {
    const statement = strings.join(' ')
    if (statement.includes('from platform_resource_purge_work'))
      return Promise.resolve([
        {
          purgeWorkId: '11111111-1111-4111-8111-111111111111',
          moduleId: 'member-audit',
          resourceId: 'trained-skills',
          mode: 'account',
          targetUserId: '22222222-2222-4222-8222-222222222222',
        },
        {
          purgeWorkId: '33333333-3333-4333-8333-333333333333',
          moduleId: 'member-audit',
          resourceId: 'trained-skills',
          mode: 'authority',
          organizationVersion: 2,
          targetUserId: '22222222-2222-4222-8222-222222222222',
          managedMemberLifecycleId: '44444444-4444-4444-8444-444444444444',
          characterId: 90_000_001,
          characterLifecycleId: '55555555-5555-4555-8555-555555555555',
          authorizationGeneration: 4,
          disclosureVersion: 2,
          sectionActivationVersion: 3,
        },
      ])
    return Promise.resolve([])
  })
  const resource = {
    moduleId: 'member-audit',
    resourceId: 'trained-skills',
    operationId: 'skills',
    sectionId: 'skills',
    subjectKind: 'character',
    materializationIntervalSeconds: 900,
    eligibility: { kind: 'current-managed-member-character' },
    implementation: { maintain },
  } as unknown as PlatformInstalledResourceDescriptor

  await runInstalledResourceMaintenance({ connection: connection as never, resources: [resource] })

  expect(maintain).toHaveBeenCalledWith(
    expect.objectContaining({
      purgeAccountIds: ['22222222-2222-4222-8222-222222222222'],
      invalidAuthorities: [expect.objectContaining({ characterId: 90_000_001 })],
    }),
  )
  expect(
    connection.mock.calls.filter(([strings]) =>
      (strings as TemplateStringsArray)
        .join(' ')
        .includes('delete from platform_resource_purge_work'),
    ),
  ).toHaveLength(2)
})
