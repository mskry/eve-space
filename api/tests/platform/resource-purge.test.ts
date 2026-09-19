import { beforeEach, expect, test, vi } from 'vitest'

const resources = vi.hoisted(() => [
  {
    moduleId: 'member-audit',
    resourceId: 'trained-skills',
    implementation: { maintain: vi.fn() },
  },
  {
    moduleId: 'other-module',
    resourceId: 'unmaintained',
    implementation: {},
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
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([
          {
            moduleId: 'member-audit',
            resourceId: 'trained-skills',
            targetUserId: '11111111-1111-4111-8111-111111111111',
            organizationVersion: 3,
            managedMemberLifecycleId: '22222222-2222-4222-8222-222222222222',
            characterId: '90000001',
            characterLifecycleId: '33333333-3333-4333-8333-333333333333',
            authorizationGeneration: 4,
            disclosureVersion: 2,
            sectionActivationVersion: 5,
          },
        ]),
      })),
    })),
    insert: vi.fn(() => ({ values })),
  }

  await enqueueInstalledResourceLifecyclePurges(
    transaction as never,
    '33333333-3333-4333-8333-333333333333',
  )

  expect(values).toHaveBeenCalledWith([
    expect.objectContaining({
      mode: 'authority',
      moduleId: 'member-audit',
      resourceId: 'trained-skills',
      characterId: 90_000_001,
    }),
  ])
})

test('retains account purge work for every installed maintainable resource', async () => {
  const values = vi.fn().mockResolvedValue(undefined)
  const transaction = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue([{ moduleId: 'member-audit' }]),
      })),
    })),
    insert: vi.fn(() => ({ values })),
  }

  await enqueueInstalledResourceAccountPurges(
    transaction as never,
    '11111111-1111-4111-8111-111111111111',
  )

  expect(values).toHaveBeenCalledWith([
    {
      moduleId: 'member-audit',
      resourceId: 'trained-skills',
      mode: 'account',
      targetUserId: '11111111-1111-4111-8111-111111111111',
    },
  ])
})
