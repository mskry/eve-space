import type {
  PlatformCollectionStatus,
  PlatformInstalledResourceDescriptor,
} from '@eve-space/platform-module-contract'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  selectResults: [] as unknown[][],
}))

vi.mock('../../src/db/client.js', () => ({ db: { select: mocks.select } }))

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
  resource('alpha', 'alliance-activity', 'alliance'),
  resource('alpha', 'deployment-activity', 'deployment'),
  resource('beta', 'character-activity', 'character'),
  resource('beta', 'beta-only', 'character'),
]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.selectResults.length = 0
  mocks.select.mockImplementation(() => databaseQuery(mocks.selectResults.shift() ?? []))
})

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

  test.each([
    ['deployment-activity', { kind: 'deployment', deploymentId: 1 }, '1'],
    ['alliance-activity', { kind: 'alliance', allianceId: 99_000_001 }, '99000001'],
  ] as const)(
    'loads the current %s lifecycle from storage',
    async (resourceId, subject, subjectId) => {
      mocks.selectResults.push([{ subjectLifecycleId: corporationLifecycleId }])
      const readStatus = vi.fn().mockResolvedValue(currentStatus)
      const reads = createPlatformModuleCollectionStatusReads(
        { moduleId: 'alpha', organizationVersion: 7 },
        { resources, readStatus },
      )

      await expect(reads.read(resourceId, subject)).resolves.toEqual({
        ...currentStatus,
        subjectLifecycleId: corporationLifecycleId,
      })
      expect(readStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceId,
          subjectId,
          subjectLifecycleId: corporationLifecycleId,
        }),
        expect.anything(),
      )
    },
  )

  test('returns never-configured for a managed corporation without a source lifecycle', async () => {
    mocks.selectResults.push([], [{ corporationId: 98_000_001 }])
    const readStatus = vi.fn()
    const reads = createPlatformModuleCollectionStatusReads(
      { moduleId: 'alpha', organizationVersion: 7 },
      { resources, readStatus },
    )

    await expect(
      reads.read('corporation-activity', { kind: 'corporation', corporationId: 98_000_001 }),
    ).resolves.toEqual({
      status: 'never-configured',
      authorizationGeneration: null,
      validatedAt: null,
      lastFailureClass: null,
    })
    expect(readStatus).not.toHaveBeenCalled()
  })

  test.each([
    { kind: 'character', characterId: 0 },
    { kind: 'corporation', corporationId: Number.NaN },
    { kind: 'alliance', allianceId: -1 },
    { kind: 'deployment', deploymentId: Number.MAX_SAFE_INTEGER + 1 },
  ] as const)('rejects an invalid $kind subject identifier', async (subject) => {
    const reads = createPlatformModuleCollectionStatusReads(
      { moduleId: 'alpha', organizationVersion: 7 },
      { resources },
    )

    await expect(reads.read('character-activity', subject)).rejects.toThrow(
      'must use a positive safe integer',
    )
  })

  test('stops a collection-status read when cancellation occurs during storage', async () => {
    const controller = new AbortController()
    const readStatus = vi.fn().mockImplementation(async () => {
      controller.abort()
      return currentStatus
    })
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
  })
})

function resource(
  moduleId: string,
  resourceId: string,
  subjectKind: 'character' | 'corporation' | 'alliance' | 'deployment',
): PlatformInstalledResourceDescriptor {
  const eligibility =
    subjectKind === 'character'
      ? { kind: 'current-owned-character' }
      : subjectKind === 'corporation'
        ? { kind: 'current-managed-corporation-source' }
        : subjectKind === 'alliance'
          ? { kind: 'current-managed-alliance' }
          : { kind: 'current-deployment' }
  return {
    moduleId,
    resourceId,
    operationId: `${moduleId}-${resourceId}`,
    subjectKind,
    materializationIntervalSeconds: 900,
    eligibility,
    implementation: {},
  } as PlatformInstalledResourceDescriptor
}

function databaseQuery(rows: unknown[]) {
  const query = Promise.resolve(rows) as Promise<unknown[]> & {
    from: ReturnType<typeof vi.fn>
    innerJoin: ReturnType<typeof vi.fn>
    where: ReturnType<typeof vi.fn>
  }
  query.from = vi.fn(() => query)
  query.innerJoin = vi.fn(() => query)
  query.where = vi.fn(() => query)
  return query
}
