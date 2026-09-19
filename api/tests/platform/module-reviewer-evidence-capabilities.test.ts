import type {
  PlatformReviewerCollectionStatusReads,
  PlatformReviewerTargetContext,
} from '@eve-space/platform-module-contract/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  createInvoker: vi.fn(),
}))

vi.mock('../../src/db/client.js', () => ({ sql: {} }))
vi.mock('../../src/db/module-persistence-operation-transaction.js', () => ({
  createStandaloneModulePersistenceOperationInvoker: mocks.createInvoker,
}))

import { createPlatformReviewerEvidenceReads } from '../../src/platform/module-reviewer-evidence-capabilities.js'

const characterId = 90_000_001
const target = {
  organizationVersion: 7,
  managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
  selection: { kind: 'character', characterId },
  account: {
    userId: '00000000-0000-4000-8000-000000000002',
    mainCharacter: { characterId, name: 'Target Main' },
  },
  characters: [],
  compliance: {},
  groups: [],
  block: { blocked: false },
} as unknown as PlatformReviewerTargetContext
const currentStatus = {
  status: 'current' as const,
  moduleId: 'member-audit',
  sectionId: 'assets',
  resourceId: 'assets',
  organizationVersion: 7,
  targetUserId: '00000000-0000-4000-8000-000000000002',
  managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
  characterId,
  characterLifecycleId: '00000000-0000-4000-8000-000000000021',
  authorizationGeneration: 3,
  disclosureVersion: 4,
  sectionActivationVersion: 5,
  validatedAt: '2026-09-17T12:00:00.000Z',
  lastFailureClass: null,
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
        routeId: 'assets-detail',
        resourceId: 'assets',
        operationId: 'read-asset-evidence',
        target,
      },
      collectionStatus,
    )

    await expect(reads.read()).resolves.toEqual({ observationId: 'snapshot' })
    expect(readStatus).toHaveBeenCalledWith('assets', characterId)
    expect(mocks.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'read-asset-evidence', mode: 'read' }),
      {
        organizationVersion: 7,
        targetUserId: '00000000-0000-4000-8000-000000000002',
        managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
        characterId,
        characterLifecycleId: '00000000-0000-4000-8000-000000000021',
        authorizationGeneration: 3,
        disclosureVersion: 4,
        sectionActivationVersion: 5,
      },
    )
  })

  test('returns no evidence unless current authority admits a readable snapshot', async () => {
    readStatus.mockResolvedValue({
      ...currentStatus,
      status: 'authorization-required',
      authorizationGeneration: null,
    })
    const reads = createPlatformReviewerEvidenceReads(
      {
        moduleId: 'member-audit',
        routeId: 'assets-detail',
        resourceId: 'assets',
        operationId: 'read-asset-evidence',
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
          routeId: 'skills-detail',
          resourceId: 'assets',
          operationId: 'read-asset-evidence',
          target,
        },
        collectionStatus,
      ),
    ).toThrow('Reviewer evidence operation is unavailable')
  })
})
