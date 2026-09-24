import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  delete: vi.fn(),
  deleteResults: [] as unknown[][],
  insert: vi.fn(),
  insertValues: [] as unknown[],
  select: vi.fn(),
  selectResults: [] as unknown[][],
}))

vi.mock('../../src/db/client.js', () => ({
  db: {
    delete: mocks.delete,
    insert: mocks.insert,
    select: mocks.select,
  },
}))

import {
  consumeOAuthState,
  findOAuthState,
  storeOAuthState,
} from '../../src/auth/oauth-state-store.js'

const reviewerUseDisclosures = [
  { disclosureVersion: 3, moduleId: 'member-audit', sectionId: 'wallet' },
] as const

describe('OAuth state store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-11T12:00:00.000Z'))
    mocks.deleteResults.length = 0
    mocks.insertValues.length = 0
    mocks.selectResults.length = 0
    mocks.delete.mockImplementation(() => deleteQuery(mocks.deleteResults.shift() ?? []))
    mocks.insert.mockImplementation(() => insertQuery())
    mocks.select.mockImplementation(() => selectQuery(mocks.selectResults.shift() ?? []))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test.each([
    {
      context: { intent: 'login', returnPath: '/dashboard', reviewerUseDisclosures } as const,
      expected: {
        characterId: null,
        intent: 'login',
        organizationDeploymentId: null,
        organizationId: null,
        organizationVersion: null,
        returnPath: '/dashboard',
        reviewerUseDisclosures,
        transferApprovalId: null,
        transferSourceSubjectLifecycleId: null,
        transferSourceUserId: null,
        userId: null,
      },
    },
    {
      context: { intent: 'attach', reviewerUseDisclosures, userId: 'user-1' } as const,
      expected: {
        characterId: null,
        intent: 'attach',
        organizationDeploymentId: null,
        organizationId: null,
        organizationVersion: null,
        returnPath: null,
        reviewerUseDisclosures,
        transferApprovalId: null,
        transferSourceSubjectLifecycleId: null,
        transferSourceUserId: null,
        userId: 'user-1',
      },
    },
    {
      context: {
        characterId: 90_000_001,
        intent: 'reauthorize',
        reviewerUseDisclosures,
        userId: 'user-1',
      } as const,
      expected: {
        characterId: 90_000_001,
        intent: 'reauthorize',
        organizationDeploymentId: null,
        organizationId: null,
        organizationVersion: null,
        returnPath: null,
        reviewerUseDisclosures,
        transferApprovalId: null,
        transferSourceSubjectLifecycleId: null,
        transferSourceUserId: null,
        userId: 'user-1',
      },
    },
    {
      context: {
        characterId: 90_000_001,
        intent: 'claim-organization-owner',
        organizationId: 98_000_001,
        organizationVersion: 8,
        reviewerUseDisclosures,
        userId: 'user-1',
      } as const,
      expected: {
        characterId: 90_000_001,
        intent: 'claim-organization-owner',
        organizationDeploymentId: 1,
        organizationId: 98_000_001,
        organizationVersion: 8,
        returnPath: null,
        reviewerUseDisclosures,
        transferApprovalId: null,
        transferSourceSubjectLifecycleId: null,
        transferSourceUserId: null,
        userId: 'user-1',
      },
    },
    {
      context: {
        approvalId: 'approval-1',
        characterId: 90_000_001,
        intent: 'transfer',
        reviewerUseDisclosures,
        sourceSubjectLifecycleId: 'lifecycle-1',
        sourceUserId: 'source-user-1',
        userId: 'user-1',
      } as const,
      expected: {
        characterId: 90_000_001,
        intent: 'transfer',
        organizationDeploymentId: null,
        organizationId: null,
        organizationVersion: null,
        returnPath: null,
        reviewerUseDisclosures,
        transferApprovalId: 'approval-1',
        transferSourceSubjectLifecycleId: 'lifecycle-1',
        transferSourceUserId: 'source-user-1',
        userId: 'user-1',
      },
    },
  ])(
    'stores $context.intent state context with only its applicable fields',
    async ({ context, expected }) => {
      await storeOAuthState('state-1', context)

      expect(mocks.delete).toHaveBeenCalledOnce()
      expect(mocks.insert).toHaveBeenCalledOnce()
      expect(mocks.insertValues).toStrictEqual([
        expect.objectContaining({
          ...expected,
          expiresAt: new Date('2026-09-11T12:10:00.000Z'),
        }),
      ])
    },
  )

  test.each([
    {
      expected: { intent: 'login', returnPath: '/dashboard', reviewerUseDisclosures },
      record: record({
        intent: 'login',
        returnPath: '/dashboard',
        reviewerUseDisclosures,
      }),
    },
    {
      expected: { intent: 'login', reviewerUseDisclosures: [] },
      record: record({ intent: 'login', returnPath: null }),
    },
    {
      expected: { intent: 'attach', reviewerUseDisclosures: [], userId: 'user-1' },
      record: record({ intent: 'attach', userId: 'user-1' }),
    },
    {
      expected: {
        characterId: 90_000_001,
        intent: 'reauthorize',
        returnPath: '/characters/90000001',
        reviewerUseDisclosures: [],
        userId: 'user-1',
      },
      record: record({
        intent: 'reauthorize',
        userId: 'user-1',
        characterId: 90_000_001,
        returnPath: '/characters/90000001',
        reviewerUseDisclosures: [],
      }),
    },
    {
      expected: {
        characterId: 90_000_001,
        intent: 'reauthorize',
        reviewerUseDisclosures: [],
        userId: 'user-1',
      },
      record: record({
        intent: 'reauthorize',
        userId: 'user-1',
        characterId: 90_000_001,
      }),
    },
    {
      expected: {
        characterId: 90_000_001,
        intent: 'claim-organization-owner',
        organizationId: 98_000_001,
        organizationVersion: 8,
        reviewerUseDisclosures: [],
        userId: 'user-1',
      },
      record: record({
        intent: 'claim-organization-owner',
        userId: 'user-1',
        characterId: 90_000_001,
        organizationId: 98_000_001,
        organizationVersion: 8,
        reviewerUseDisclosures: [],
      }),
    },
    {
      expected: {
        approvalId: 'approval-1',
        characterId: 90_000_001,
        intent: 'transfer',
        reviewerUseDisclosures: [],
        sourceSubjectLifecycleId: 'lifecycle-1',
        sourceUserId: 'source-user-1',
        userId: 'user-1',
      },
      record: record({
        intent: 'transfer',
        transferApprovalId: 'approval-1',
        transferSourceUserId: 'source-user-1',
        transferSourceSubjectLifecycleId: 'lifecycle-1',
        userId: 'user-1',
        characterId: 90_000_001,
      }),
    },
  ])(
    'consumes a valid $expected.intent state context',
    async ({ record: storedRecord, expected }) => {
      mocks.deleteResults.push([storedRecord])

      await expect(consumeOAuthState('state-1')).resolves.toStrictEqual(expected)
    },
  )

  test('returns null when no unexpired state was deleted', async () => {
    mocks.deleteResults.push([])

    await expect(consumeOAuthState('state-1')).resolves.toBeNull()
  })

  test.each([
    null,
    {},
    [{ disclosureVersion: 0, moduleId: 'member-audit', sectionId: 'wallet' }],
    [
      { disclosureVersion: 1, moduleId: 'member-audit', sectionId: 'wallet' },
      { disclosureVersion: 2, moduleId: 'member-audit', sectionId: 'wallet' },
    ],
    [{ disclosureVersion: 1, extra: true, moduleId: 'member-audit', sectionId: 'wallet' }],
  ])('rejects malformed or duplicate reviewer-use disclosures', async (value) => {
    mocks.deleteResults.push([record({ reviewerUseDisclosures: value })])

    await expect(consumeOAuthState('state-1')).rejects.toThrow('reviewer-use disclosures')
  })

  test.each([
    record({ intent: 'attach', userId: null }),
    record({ characterId: 90_000_001, intent: 'reauthorize', userId: null }),
    record({ characterId: null, intent: 'reauthorize', userId: 'user-1' }),
    record({
      characterId: 90_000_001,
      intent: 'claim-organization-owner',
      organizationId: 98_000_001,
      organizationVersion: 8,
      userId: null,
    }),
    record({
      characterId: null,
      intent: 'claim-organization-owner',
      organizationId: 98_000_001,
      organizationVersion: 8,
      userId: 'user-1',
    }),
    record({
      characterId: 90_000_001,
      intent: 'claim-organization-owner',
      organizationId: null,
      organizationVersion: 8,
      userId: 'user-1',
    }),
    record({
      characterId: 90_000_001,
      intent: 'claim-organization-owner',
      organizationId: 98_000_001,
      organizationVersion: null,
      userId: 'user-1',
    }),
    record({
      characterId: 90_000_001,
      intent: 'transfer',
      transferApprovalId: null,
      transferSourceSubjectLifecycleId: 'lifecycle-1',
      transferSourceUserId: 'source-user-1',
      userId: 'user-1',
    }),
    record({
      characterId: 90_000_001,
      intent: 'transfer',
      transferApprovalId: 'approval-1',
      transferSourceSubjectLifecycleId: 'lifecycle-1',
      transferSourceUserId: null,
      userId: 'user-1',
    }),
    record({
      characterId: 90_000_001,
      intent: 'transfer',
      transferApprovalId: 'approval-1',
      transferSourceSubjectLifecycleId: null,
      transferSourceUserId: 'source-user-1',
      userId: 'user-1',
    }),
    record({
      characterId: 90_000_001,
      intent: 'transfer',
      transferApprovalId: 'approval-1',
      transferSourceSubjectLifecycleId: 'lifecycle-1',
      transferSourceUserId: 'source-user-1',
      userId: null,
    }),
    record({
      characterId: null,
      intent: 'transfer',
      transferApprovalId: 'approval-1',
      transferSourceSubjectLifecycleId: 'lifecycle-1',
      transferSourceUserId: 'source-user-1',
      userId: 'user-1',
    }),
  ])('rejects an incomplete stored authorization context', async (storedRecord) => {
    mocks.deleteResults.push([storedRecord])

    await expect(consumeOAuthState('state-1')).rejects.toThrow(
      'Stored OAuth state has invalid authorization context',
    )
  })

  test('loads pending state without consuming it', async () => {
    mocks.selectResults.push([
      record({ intent: 'login', returnPath: '/dashboard', reviewerUseDisclosures }),
    ])

    await expect(findOAuthState('state-1')).resolves.toStrictEqual({
      intent: 'login',
      returnPath: '/dashboard',
      reviewerUseDisclosures,
    })
    expect(mocks.delete).not.toHaveBeenCalled()
  })
})

function deleteQuery(result: unknown[]) {
  const builder = query(result)
  builder.where = () => builder
  builder.returning = () => builder
  return builder
}

function insertQuery() {
  const builder = query([])
  builder.values = (value: unknown) => {
    mocks.insertValues.push(value)
    return builder
  }
  return builder
}

function selectQuery(result: unknown[]) {
  const builder = query(result)
  builder.from = () => builder
  builder.where = () => builder
  return builder
}

function query(result: unknown[]) {
  const builder: Record<string, unknown> = {}
  // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are awaitable.
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

function record(overrides: Record<string, unknown>) {
  return {
    characterId: null,
    intent: 'login',
    organizationId: null,
    organizationVersion: null,
    returnPath: null,
    reviewerUseDisclosures: [],
    transferApprovalId: null,
    transferSourceSubjectLifecycleId: null,
    transferSourceUserId: null,
    userId: null,
    ...overrides,
  }
}
