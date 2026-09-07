import type {
  PlatformCollectionStatus,
  PlatformInstalledResourceDescriptor,
} from '@eve-space/platform-module-contract'
import { describe, expect, test, vi } from 'vitest'
import { createPlatformModuleCollectionStatusReads } from '../../src/platform/module-collection-status-capabilities.js'

const characterLifecycleId = '35acd527-9539-44ad-aacf-9f8e45232267'
const corporationLifecycleId = 'ad599062-762a-46a4-8f89-b900b06c8311'
const currentStatus: PlatformCollectionStatus = {
  status: 'current',
  authorizationGeneration: 4,
  validatedAt: '2026-09-06T10:00:00.000Z',
  lastFailureClass: null,
}
const resources = [
  resource('alpha', 'character-activity', 'character'),
  resource('alpha', 'corporation-activity', 'corporation'),
  resource('beta', 'character-activity', 'character'),
  resource('beta', 'beta-only', 'character'),
]

describe('platform module collection-status capabilities', () => {
  test('binds the calling module and authorized character lifecycle', async () => {
    const readStatus = vi.fn().mockResolvedValue(currentStatus)
    const reads = createPlatformModuleCollectionStatusReads(
      {
        moduleId: 'alpha',
        organizationVersion: 7,
        characters: [{ characterId: 9001, subjectLifecycleId: characterLifecycleId }],
      },
      { resources, readStatus },
    )

    await expect(
      reads.read('character-activity', { kind: 'character', characterId: 9001 }),
    ).resolves.toEqual({ ...currentStatus, subjectLifecycleId: characterLifecycleId })
    expect(readStatus).toHaveBeenCalledWith(
      {
        moduleId: 'alpha',
        resourceId: 'character-activity',
        subjectKind: 'character',
        subjectLifecycleId: characterLifecycleId,
        subjectId: '9001',
      },
      { resources: [resources[0]] },
    )
  })

  test('refuses undeclared, cross-module, and unauthorized character reads', async () => {
    const readStatus = vi.fn()
    const reads = createPlatformModuleCollectionStatusReads(
      {
        moduleId: 'alpha',
        organizationVersion: 7,
        characters: [{ characterId: 9001, subjectLifecycleId: characterLifecycleId }],
      },
      { resources, readStatus },
    )

    await expect(reads.read('missing', { kind: 'character', characterId: 9001 })).rejects.toThrow(
      'resource is unavailable',
    )
    await expect(reads.read('beta-only', { kind: 'character', characterId: 9001 })).rejects.toThrow(
      'resource is unavailable',
    )
    await expect(
      reads.read('character-activity', { kind: 'character', characterId: 9002 }),
    ).rejects.toThrow('outside the authorized module context')
    await expect(
      reads.read('corporation-activity', { kind: 'character', characterId: 9001 }),
    ).rejects.toThrow('resource is unavailable')
    expect(readStatus).not.toHaveBeenCalled()
  })

  test('resolves organization lifecycles inside the authorized organization version', async () => {
    const readStatus = vi.fn().mockResolvedValue(currentStatus)
    const loadOrganizationLifecycle = vi.fn().mockResolvedValue({
      subjectLifecycleId: corporationLifecycleId,
      subjectId: '98000001',
    })
    const reads = createPlatformModuleCollectionStatusReads(
      { moduleId: 'alpha', organizationVersion: 7 },
      { resources, readStatus, loadOrganizationLifecycle },
    )

    await reads.read('corporation-activity', {
      kind: 'corporation',
      corporationId: 98_000_001,
    })

    expect(loadOrganizationLifecycle).toHaveBeenCalledWith(7, {
      kind: 'corporation',
      corporationId: 98_000_001,
    })
    expect(readStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        moduleId: 'alpha',
        subjectLifecycleId: corporationLifecycleId,
        subjectId: '98000001',
      }),
      { resources: [resources[1]] },
    )
  })

  test('stops provider reads after cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    const readStatus = vi.fn()
    const reads = createPlatformModuleCollectionStatusReads(
      {
        moduleId: 'alpha',
        organizationVersion: 7,
        characters: [{ characterId: 9001, subjectLifecycleId: characterLifecycleId }],
        signal: controller.signal,
      },
      { resources, readStatus },
    )

    await expect(
      reads.read('character-activity', { kind: 'character', characterId: 9001 }),
    ).rejects.toThrow('was aborted')
    expect(readStatus).not.toHaveBeenCalled()
  })
})

function resource(
  moduleId: string,
  resourceId: string,
  subjectKind: 'character' | 'corporation',
): PlatformInstalledResourceDescriptor {
  return {
    moduleId,
    resourceId,
    operationId: `${moduleId}-${resourceId}`,
    subjectKind,
    materializationIntervalSeconds: 900,
    eligibility:
      subjectKind === 'character'
        ? { kind: 'current-owned-character' }
        : { kind: 'current-managed-corporation-source' },
    implementation: {},
  } as PlatformInstalledResourceDescriptor
}
