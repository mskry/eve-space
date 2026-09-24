import type {
  PlatformReviewerCollectionStatusReads,
  PlatformReviewerTargetContext,
} from '@eve-space/platform-module-contract/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createInvoker: vi.fn(),
  invoke: vi.fn(),
}))

vi.mock('../../src/db/client.js', () => ({ sql: {} }))
vi.mock('../../src/db/module-persistence-operation-transaction.js', () => ({
  createStandaloneModulePersistenceOperationInvoker: mocks.createInvoker,
}))

import { createPlatformReviewerEvidenceReads } from '../../src/platform/module-reviewer-evidence-capabilities.js'

const characterId = 90_000_001
const target = {
  account: {
    mainCharacter: { characterId, name: 'Target Main' },
    userId: '00000000-0000-4000-8000-000000000002',
  },
  block: { blocked: false },
  characters: [],
  compliance: {},
  groups: [],
  managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
  organizationVersion: 7,
  selection: { characterId, kind: 'character' },
} as unknown as PlatformReviewerTargetContext
const currentStatus = {
  authorizationGeneration: 3,
  characterId,
  characterLifecycleId: '00000000-0000-4000-8000-000000000021',
  disclosureVersion: 4,
  lastFailureClass: null,
  managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
  moduleId: 'member-audit',
  organizationVersion: 7,
  resourceId: 'assets',
  sectionActivationVersion: 5,
  sectionId: 'assets',
  status: 'current' as const,
  targetUserId: '00000000-0000-4000-8000-000000000002',
  validatedAt: '2026-09-17T12:00:00.000Z',
}
const readStatus = vi.fn()
const collectionStatus = {
  read: readStatus,
} as unknown as PlatformReviewerCollectionStatusReads

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createInvoker.mockReturnValue(mocks.invoke)
})

describe('platform reviewer evidence capabilities', () => {
  test('derives the complete persistence authority from target-bound collection status', async () => {
    readStatus.mockResolvedValue(currentStatus)
    mocks.invoke.mockResolvedValue({ observationId: 'snapshot' })
    const reads = createPlatformReviewerEvidenceReads(
      {
        moduleId: 'member-audit',
        operationId: 'read-asset-evidence',
        resourceId: 'assets',
        routeId: 'assets-detail',
        target,
      },
      collectionStatus,
    )

    await expect(reads.read()).resolves.toStrictEqual({ observationId: 'snapshot' })
    expect(readStatus).toHaveBeenCalledWith('assets', characterId)
    expect(mocks.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'read', operationId: 'read-asset-evidence' }),
      {
        authorizationGeneration: 3,
        characterId,
        characterLifecycleId: '00000000-0000-4000-8000-000000000021',
        disclosureVersion: 4,
        managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
        organizationVersion: 7,
        sectionActivationVersion: 5,
        targetUserId: '00000000-0000-4000-8000-000000000002',
      },
    )
  })

  test('returns no evidence unless current authority admits a readable snapshot', async () => {
    readStatus.mockResolvedValue({
      ...currentStatus,
      authorizationGeneration: null,
      status: 'authorization-required',
    })
    const reads = createPlatformReviewerEvidenceReads(
      {
        moduleId: 'member-audit',
        operationId: 'read-asset-evidence',
        resourceId: 'assets',
        routeId: 'assets-detail',
        target,
      },
      collectionStatus,
    )

    await expect(reads.read()).resolves.toBeNull()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  test('rejects persistence operations not granted to the exact route', () => {
    expect(() =>
      createPlatformReviewerEvidenceReads(
        {
          moduleId: 'member-audit',
          operationId: 'read-asset-evidence',
          resourceId: 'assets',
          routeId: 'skills-detail',
          target,
        },
        collectionStatus,
      ),
    ).toThrow('Reviewer evidence operation is unavailable')
  })
})
