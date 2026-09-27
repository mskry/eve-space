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
  compliance: {
    accessValidUntil: null,
    evaluatedAt: null,
    evidenceAt: null,
    evidenceFreshness: 'unavailable',
    reviewDeadline: null,
    state: 'pending',
  },
  groups: [],
  managedMemberLifecycleId: '00000000-0000-4000-8000-000000000020',
  organizationVersion: 7,
  selection: {
    characterId,
    kind: 'character',
    subjectLifecycleId: '00000000-0000-4000-8000-000000000021',
  },
} as const satisfies PlatformReviewerTargetContext
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
} satisfies PlatformReviewerCollectionStatusReads
const assetsBinding = {
  moduleId: 'member-audit',
  operationId: 'read-asset-evidence',
  resources: [{ resourceId: 'assets', field: null }],
  routeId: 'assets-detail',
  target,
} as const
const walletBinding = {
  moduleId: 'member-audit',
  operationId: 'read-wallet-evidence',
  resources: [
    { resourceId: 'wallet-balance', field: 'balance' },
    { resourceId: 'wallet-journal', field: 'journal' },
    { resourceId: 'wallet-transactions', field: 'transactions' },
  ],
  routeId: 'wallet-detail',
  target,
} as const
const mailBinding = {
  moduleId: 'member-audit',
  operationId: 'read-mail-evidence',
  resources: [
    { resourceId: 'mail-headers', field: 'headers' },
    { resourceId: 'mail-details', field: 'contents' },
  ],
  routeId: 'mail-detail',
  target,
} as const

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createInvoker.mockReturnValue(mocks.invoke)
})

describe('platform reviewer evidence capabilities', () => {
  test('derives the complete persistence authority from target-bound collection status', async () => {
    readStatus.mockResolvedValue(currentStatus)
    mocks.invoke.mockResolvedValue({ observationId: 'snapshot' })
    const reads = createPlatformReviewerEvidenceReads(assetsBinding, collectionStatus)

    await expect(reads.read()).resolves.toStrictEqual({
      assets: { evidence: { observationId: 'snapshot' }, status: currentStatus },
    })
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

  test.each([
    ['array', [{ observationId: 'snapshot' }]],
    ['number', 0],
    ['string', 'snapshot'],
    ['boolean', false],
    ['null', null],
  ] as const)('preserves a validated whole-result %s', async (_kind, output) => {
    readStatus.mockResolvedValue(currentStatus)
    mocks.invoke.mockResolvedValue(output)

    await expect(
      createPlatformReviewerEvidenceReads(assetsBinding, collectionStatus).read(),
    ).resolves.toStrictEqual({ assets: { evidence: output, status: currentStatus } })
  })

  test('requires an object when a binding selects a named result field', async () => {
    readStatus.mockImplementation(async (resourceId: string) => ({
      ...currentStatus,
      resourceId,
      sectionId: 'wallet',
    }))
    mocks.invoke.mockResolvedValue(['unexpected'])

    await expect(
      createPlatformReviewerEvidenceReads(walletBinding, collectionStatus).read(),
    ).rejects.toThrow('record')
  })

  test('returns no evidence unless current authority admits a readable snapshot', async () => {
    readStatus.mockResolvedValue({
      ...currentStatus,
      authorizationGeneration: null,
      status: 'authorization-required',
    })
    const reads = createPlatformReviewerEvidenceReads(assetsBinding, collectionStatus)

    await expect(reads.read()).resolves.toStrictEqual({
      assets: {
        evidence: null,
        status: {
          ...currentStatus,
          authorizationGeneration: null,
          status: 'authorization-required',
        },
      },
    })
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  test.each(['never-collected', 'unavailable'] as const)(
    'preserves journal and transactions when balance is %s',
    async (balanceStatus) => {
      readStatus.mockImplementation(async (resourceId: string) => ({
        ...currentStatus,
        resourceId,
        sectionId: 'wallet',
        status: resourceId === 'wallet-balance' ? balanceStatus : 'current',
      }))
      mocks.invoke.mockResolvedValue({
        balance: { snapshot: { balance: 42 } },
        journal: [{ amount: 5 }],
        transactions: [],
      })
      const reads = createPlatformReviewerEvidenceReads(walletBinding, collectionStatus)

      const result = await reads.read({ limit: 500 })

      expect(result).toMatchObject({
        'wallet-balance': { evidence: null, status: { status: balanceStatus } },
        'wallet-journal': { evidence: [{ amount: 5 }], status: { status: 'current' } },
        'wallet-transactions': { evidence: [], status: { status: 'current' } },
      })
      expect(mocks.invoke).toHaveBeenCalledOnce()
    },
  )

  test('does not combine evidence across authorization generations', async () => {
    readStatus.mockImplementation(async (resourceId: string) => ({
      ...currentStatus,
      resourceId,
      sectionId: 'wallet',
      authorizationGeneration: resourceId === 'wallet-journal' ? 4 : 3,
    }))
    const reads = createPlatformReviewerEvidenceReads(walletBinding, collectionStatus)

    await expect(reads.read()).rejects.toThrow('Reviewer evidence authority changed')
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  test('refuses a result when authority changes during persistence read', async () => {
    let reads = 0
    readStatus.mockImplementation(async () => ({
      ...currentStatus,
      authorizationGeneration: ++reads === 1 ? 3 : 4,
    }))
    mocks.invoke.mockResolvedValue({ observationId: 'prior-generation' })

    await expect(
      createPlatformReviewerEvidenceReads(assetsBinding, collectionStatus).read(),
    ).rejects.toThrow('Reviewer evidence authority changed')
    expect(mocks.invoke).toHaveBeenCalledOnce()
  })

  test('retries a promoted observation instead of pairing old evidence with its new validation time', async () => {
    const promotedStatus = { ...currentStatus, validatedAt: '2026-09-17T12:05:00.000Z' }
    let statusReads = 0
    readStatus.mockImplementation(async () => {
      statusReads += 1
      return statusReads === 1 ? currentStatus : promotedStatus
    })
    mocks.invoke
      .mockResolvedValueOnce({ observationId: 'old-observation' })
      .mockResolvedValueOnce({ observationId: 'new-observation' })

    await expect(
      createPlatformReviewerEvidenceReads(assetsBinding, collectionStatus).read(),
    ).resolves.toStrictEqual({
      assets: { evidence: { observationId: 'new-observation' }, status: promotedStatus },
    })
    expect(mocks.invoke).toHaveBeenCalledTimes(2)
    expect(readStatus).toHaveBeenCalledTimes(4)
  })

  test('does not present evidence when collection metadata keeps changing', async () => {
    let statusReads = 0
    readStatus.mockImplementation(async () => ({
      ...currentStatus,
      validatedAt: new Date(
        Date.parse(currentStatus.validatedAt) + statusReads++ * 1000,
      ).toISOString(),
    }))
    mocks.invoke.mockResolvedValue({ observationId: 'superseded' })

    await expect(
      createPlatformReviewerEvidenceReads(assetsBinding, collectionStatus).read(),
    ).rejects.toThrow('Reviewer evidence changed during read')
    expect(mocks.invoke).toHaveBeenCalledTimes(2)
  })

  test('keeps mail details readable when header collection has never completed', async () => {
    readStatus.mockImplementation(async (resourceId: string) => ({
      ...currentStatus,
      resourceId,
      sectionId: 'mail',
      status: resourceId === 'mail-headers' ? 'never-collected' : 'current',
    }))
    mocks.invoke.mockResolvedValue({ headers: [], contents: [{ mailId: 42, body: 'Hello' }] })

    const result = await createPlatformReviewerEvidenceReads(mailBinding, collectionStatus).read({
      limit: 500,
    })

    expect(result).toMatchObject({
      'mail-headers': { evidence: null, status: { status: 'never-collected' } },
      'mail-details': { evidence: [{ mailId: 42, body: 'Hello' }], status: { status: 'current' } },
    })
  })

  test('rejects persistence operations not granted to the exact route', () => {
    expect(() =>
      createPlatformReviewerEvidenceReads(
        { ...assetsBinding, routeId: 'skills-detail' },
        collectionStatus,
      ),
    ).toThrow('Reviewer evidence operation is unavailable')
  })
})
