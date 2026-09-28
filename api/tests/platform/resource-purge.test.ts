import { beforeEach, expect, test, vi } from 'vitest'

const resources = vi.hoisted(() => [
  {
    implementation: { maintain: vi.fn() },
    moduleId: 'member-audit',
    resourceId: 'trained-skills',
  },
  {
    implementation: { maintain: vi.fn() },
    moduleId: 'member-audit',
    resourceId: 'current-ship',
  },
  {
    implementation: { maintain: vi.fn() },
    moduleId: 'member-audit',
    resourceId: 'current-location',
  },
  {
    implementation: {},
    moduleId: 'other-module',
    resourceId: 'unmaintained',
  },
])

vi.mock('../../src/generated/platform/installed-module-worker.js', () => ({
  installedModuleResources: resources,
}))

import {
  enqueueInstalledResourceAccountPurges,
  enqueueInstalledResourceLifecyclePurges,
} from '../../src/platform/resource-purge.js'

beforeEach(() => vi.clearAllMocks())

test('retains authority purge work before a lifecycle state can cascade', async () => {
  const values = vi.fn().mockResolvedValue(undefined)
  const transaction = {
    insert: vi.fn(() => ({ values })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(
          ['trained-skills', 'current-ship', 'current-location'].map((resourceId) => ({
            moduleId: 'member-audit',
            resourceId,
            targetUserId: '11111111-1111-4111-8111-111111111111',
            organizationVersion: 3,
            managedMemberLifecycleId: '22222222-2222-4222-8222-222222222222',
            characterId: '90000001',
            characterLifecycleId: '33333333-3333-4333-8333-333333333333',
            authorizationGeneration: 4,
            disclosureVersion: 2,
            sectionActivationVersion: 5,
          })),
        ),
      })),
    })),
  }

  await enqueueInstalledResourceLifecyclePurges(
    transaction as never,
    '33333333-3333-4333-8333-333333333333',
  )

  expect(
    values.mock.calls[0]?.[0].map(({ resourceId }: { resourceId: string }) => resourceId),
  ).toStrictEqual(['trained-skills', 'current-ship', 'current-location'])
  expect(values).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({
        characterId: 90_000_001,
        mode: 'authority',
        moduleId: 'member-audit',
        resourceId: 'current-ship',
      }),
      expect.objectContaining({
        characterId: 90_000_001,
        mode: 'authority',
        moduleId: 'member-audit',
        resourceId: 'current-location',
      }),
    ]),
  )
})

test('retains account purge work for every installed maintainable resource', async () => {
  const values = vi.fn().mockResolvedValue(undefined)
  const transaction = {
    insert: vi.fn(() => ({ values })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ moduleId: 'member-audit' }]),
      })),
    })),
  }

  await enqueueInstalledResourceAccountPurges(
    transaction as never,
    '11111111-1111-4111-8111-111111111111',
  )

  expect(values).toHaveBeenCalledWith(
    expect.arrayContaining([
      {
        mode: 'account',
        moduleId: 'member-audit',
        resourceId: 'current-ship',
        targetUserId: '11111111-1111-4111-8111-111111111111',
      },
      {
        mode: 'account',
        moduleId: 'member-audit',
        resourceId: 'current-location',
        targetUserId: '11111111-1111-4111-8111-111111111111',
      },
    ]),
  )
})
