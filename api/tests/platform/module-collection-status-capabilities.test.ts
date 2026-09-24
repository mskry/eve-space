import type { PlatformCollectionStatus } from '@eve-space/platform-module-contract/server'
import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract/resources'
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
  authorizationGeneration: 4,
  lastFailureClass: null,
  status: 'current',
  validatedAt: '2026-09-06T10:00:00.000Z',
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
        characters: [{ characterId: 9001, subjectLifecycleId: characterLifecycleId }],
        moduleId: 'alpha',
        organizationVersion: 7,
      },
      { readStatus, resources },
    )

    await expect(
      reads.read('character-activity', { characterId: 9001, kind: 'character' }),
    ).resolves.toStrictEqual({ ...currentStatus, subjectLifecycleId: characterLifecycleId })
    expect(readStatus).toHaveBeenCalledWith(
      {
        moduleId: 'alpha',
        resourceId: 'character-activity',
        subjectId: '9001',
        subjectKind: 'character',
        subjectLifecycleId: characterLifecycleId,
      },
      { resources: [resources[0]] },
    )
  })

  test('refuses disabled and cross-section collection-status reads before storage', async () => {
    const readStatus = vi.fn()
    const isContributionEnabled = vi.fn().mockResolvedValue(false)
    const sectionResources = [
      { ...resources[0]!, sectionId: 'skills' },
      { ...resources[1]!, sectionId: 'assets' },
    ]
    const reads = createPlatformModuleCollectionStatusReads(
      {
        characters: [{ characterId: 9001, subjectLifecycleId: characterLifecycleId }],
        moduleId: 'alpha',
        organizationVersion: 7,
        sectionId: 'skills',
      },
      { isContributionEnabled, readStatus, resources: sectionResources },
    )

    await expect(
      reads.read('character-activity', { characterId: 9001, kind: 'character' }),
    ).rejects.toThrow('resource is unavailable')
    await expect(
      reads.read('corporation-activity', { corporationId: 98_000_001, kind: 'corporation' }),
    ).rejects.toThrow('resource is unavailable')
    expect(isContributionEnabled).toHaveBeenCalledWith('alpha', 'skills')
    expect(readStatus).not.toHaveBeenCalled()
    expect(mocks.select).not.toHaveBeenCalled()
  })

  test('refuses undeclared, cross-module, and unauthorized character reads', async () => {
    const readStatus = vi.fn()
    const reads = createPlatformModuleCollectionStatusReads(
      {
        characters: [{ characterId: 9001, subjectLifecycleId: characterLifecycleId }],
        moduleId: 'alpha',
        organizationVersion: 7,
      },
      { readStatus, resources },
    )

    await expect(reads.read('missing', { characterId: 9001, kind: 'character' })).rejects.toThrow(
      'resource is unavailable',
    )
    await expect(reads.read('beta-only', { characterId: 9001, kind: 'character' })).rejects.toThrow(
      'resource is unavailable',
    )
    await expect(
      reads.read('character-activity', { characterId: 9002, kind: 'character' }),
    ).rejects.toThrow('outside the authorized module context')
    await expect(
      reads.read('corporation-activity', { characterId: 9001, kind: 'character' }),
    ).rejects.toThrow('resource is unavailable')
    expect(readStatus).not.toHaveBeenCalled()
  })

  test('resolves organization lifecycles inside the authorized organization version', async () => {
    const readStatus = vi.fn().mockResolvedValue(currentStatus)
    const loadOrganizationLifecycle = vi.fn().mockResolvedValue({
      subjectId: '98000001',
      subjectLifecycleId: corporationLifecycleId,
    })
    const reads = createPlatformModuleCollectionStatusReads(
      { moduleId: 'alpha', organizationVersion: 7 },
      { loadOrganizationLifecycle, readStatus, resources },
    )

    await reads.read('corporation-activity', {
      corporationId: 98_000_001,
      kind: 'corporation',
    })

    expect(loadOrganizationLifecycle).toHaveBeenCalledWith(7, {
      corporationId: 98_000_001,
      kind: 'corporation',
    })
    expect(readStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        moduleId: 'alpha',
        subjectId: '98000001',
        subjectLifecycleId: corporationLifecycleId,
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
        characters: [{ characterId: 9001, subjectLifecycleId: characterLifecycleId }],
        moduleId: 'alpha',
        organizationVersion: 7,
        signal: controller.signal,
      },
      { readStatus, resources },
    )

    await expect(
      reads.read('character-activity', { characterId: 9001, kind: 'character' }),
    ).rejects.toThrow('was aborted')
    expect(readStatus).not.toHaveBeenCalled()
  })

  test.each([
    ['deployment-activity', { deploymentId: 1, kind: 'deployment' }, '1'],
    ['alliance-activity', { allianceId: 99_000_001, kind: 'alliance' }, '99000001'],
  ] as const)(
    'loads the current %s lifecycle from storage',
    async (resourceId, subject, subjectId) => {
      mocks.selectResults.push([{ subjectLifecycleId: corporationLifecycleId }])
      const readStatus = vi.fn().mockResolvedValue(currentStatus)
      const reads = createPlatformModuleCollectionStatusReads(
        { moduleId: 'alpha', organizationVersion: 7 },
        { readStatus, resources },
      )

      await expect(reads.read(resourceId, subject)).resolves.toStrictEqual({
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
      { readStatus, resources },
    )

    await expect(
      reads.read('corporation-activity', { corporationId: 98_000_001, kind: 'corporation' }),
    ).resolves.toStrictEqual({
      authorizationGeneration: null,
      lastFailureClass: null,
      status: 'never-configured',
      validatedAt: null,
    })
    expect(readStatus).not.toHaveBeenCalled()
  })

  test.each([
    { characterId: 0, kind: 'character' },
    { corporationId: Number.NaN, kind: 'corporation' },
    { allianceId: -1, kind: 'alliance' },
    { deploymentId: Number.MAX_SAFE_INTEGER + 1, kind: 'deployment' },
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
        characters: [{ characterId: 9001, subjectLifecycleId: characterLifecycleId }],
        moduleId: 'alpha',
        organizationVersion: 7,
        signal: controller.signal,
      },
      { readStatus, resources },
    )

    await expect(
      reads.read('character-activity', { characterId: 9001, kind: 'character' }),
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
    eligibility,
    implementation: {},
    materializationIntervalSeconds: 900,
    moduleId,
    operationId: `${moduleId}-${resourceId}`,
    resourceId,
    subjectKind,
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
