import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteResults: [] as unknown[][],
  delete: vi.fn(),
  insert: vi.fn(),
  insertValues: [] as unknown[],
}))

vi.mock('../../src/db/client.js', () => ({
  db: {
    delete: mocks.delete,
    insert: mocks.insert,
  },
}))

import { consumeOAuthState, storeOAuthState } from '../../src/auth/oauth-state-store.js'

describe('OAuth state store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-11T12:00:00.000Z'))
    mocks.deleteResults.length = 0
    mocks.insertValues.length = 0
    mocks.delete.mockImplementation(() => deleteQuery(mocks.deleteResults.shift() ?? []))
    mocks.insert.mockImplementation(() => insertQuery())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test.each([
    {
      context: { intent: 'login', returnPath: '/dashboard' } as const,
      expected: {
        intent: 'login',
        userId: null,
        characterId: null,
        returnPath: '/dashboard',
        organizationDeploymentId: null,
        organizationId: null,
        organizationVersion: null,
        transferApprovalId: null,
        transferSourceUserId: null,
        transferSourceSubjectLifecycleId: null,
      },
    },
    {
      context: { intent: 'attach', userId: 'user-1' } as const,
      expected: {
        intent: 'attach',
        userId: 'user-1',
        characterId: null,
        returnPath: null,
        organizationDeploymentId: null,
        organizationId: null,
        organizationVersion: null,
        transferApprovalId: null,
        transferSourceUserId: null,
        transferSourceSubjectLifecycleId: null,
      },
    },
    {
      context: { intent: 'reauthorize', userId: 'user-1', characterId: 90_000_001 } as const,
      expected: {
        intent: 'reauthorize',
        userId: 'user-1',
        characterId: 90_000_001,
        returnPath: null,
        organizationDeploymentId: null,
        organizationId: null,
        organizationVersion: null,
        transferApprovalId: null,
        transferSourceUserId: null,
        transferSourceSubjectLifecycleId: null,
      },
    },
    {
      context: {
        intent: 'claim-organization-owner',
        userId: 'user-1',
        characterId: 90_000_001,
        organizationId: 98_000_001,
        organizationVersion: 8,
      } as const,
      expected: {
        intent: 'claim-organization-owner',
        userId: 'user-1',
        characterId: 90_000_001,
        returnPath: null,
        organizationDeploymentId: 1,
        organizationId: 98_000_001,
        organizationVersion: 8,
        transferApprovalId: null,
        transferSourceUserId: null,
        transferSourceSubjectLifecycleId: null,
      },
    },
    {
      context: {
        intent: 'transfer',
        approvalId: 'approval-1',
        sourceUserId: 'source-user-1',
        sourceSubjectLifecycleId: 'lifecycle-1',
        userId: 'user-1',
        characterId: 90_000_001,
      } as const,
      expected: {
        intent: 'transfer',
        userId: 'user-1',
        characterId: 90_000_001,
        returnPath: null,
        organizationDeploymentId: null,
        organizationId: null,
        organizationVersion: null,
        transferApprovalId: 'approval-1',
        transferSourceUserId: 'source-user-1',
        transferSourceSubjectLifecycleId: 'lifecycle-1',
      },
    },
  ])(
    'stores $context.intent state context with only its applicable fields',
    async ({ context, expected }) => {
      await storeOAuthState('state-1', context)

      expect(mocks.delete).toHaveBeenCalledOnce()
      expect(mocks.insert).toHaveBeenCalledOnce()
      expect(mocks.insertValues).toEqual([
        expect.objectContaining({
          ...expected,
          expiresAt: new Date('2026-09-11T12:10:00.000Z'),
        }),
      ])
    },
  )

  test.each([
    {
      record: record({ intent: 'login', returnPath: '/dashboard' }),
      expected: { intent: 'login', returnPath: '/dashboard' },
    },
    {
      record: record({ intent: 'login', returnPath: null }),
      expected: { intent: 'login' },
    },
    {
      record: record({ intent: 'attach', userId: 'user-1' }),
      expected: { intent: 'attach', userId: 'user-1' },
    },
    {
      record: record({
        intent: 'reauthorize',
        userId: 'user-1',
        characterId: 90_000_001,
        returnPath: '/characters/90000001',
      }),
      expected: {
        intent: 'reauthorize',
        userId: 'user-1',
        characterId: 90_000_001,
        returnPath: '/characters/90000001',
      },
    },
    {
      record: record({
        intent: 'reauthorize',
        userId: 'user-1',
        characterId: 90_000_001,
      }),
      expected: {
        intent: 'reauthorize',
        userId: 'user-1',
        characterId: 90_000_001,
      },
    },
    {
      record: record({
        intent: 'claim-organization-owner',
        userId: 'user-1',
        characterId: 90_000_001,
        organizationId: 98_000_001,
        organizationVersion: 8,
      }),
      expected: {
        intent: 'claim-organization-owner',
        userId: 'user-1',
        characterId: 90_000_001,
        organizationId: 98_000_001,
        organizationVersion: 8,
      },
    },
    {
      record: record({
        intent: 'transfer',
        transferApprovalId: 'approval-1',
        transferSourceUserId: 'source-user-1',
        transferSourceSubjectLifecycleId: 'lifecycle-1',
        userId: 'user-1',
        characterId: 90_000_001,
      }),
      expected: {
        intent: 'transfer',
        approvalId: 'approval-1',
        sourceUserId: 'source-user-1',
        sourceSubjectLifecycleId: 'lifecycle-1',
        userId: 'user-1',
        characterId: 90_000_001,
      },
    },
  ])(
    'consumes a valid $expected.intent state context',
    async ({ record: storedRecord, expected }) => {
      mocks.deleteResults.push([storedRecord])

      await expect(consumeOAuthState('state-1')).resolves.toEqual(expected)
    },
  )

  test('returns null when no unexpired state was deleted', async () => {
    mocks.deleteResults.push([])

    await expect(consumeOAuthState('state-1')).resolves.toBeNull()
  })

  test.each([
    record({ intent: 'attach', userId: null }),
    record({ intent: 'reauthorize', userId: null, characterId: 90_000_001 }),
    record({ intent: 'reauthorize', userId: 'user-1', characterId: null }),
    record({
      intent: 'claim-organization-owner',
      userId: null,
      characterId: 90_000_001,
      organizationId: 98_000_001,
      organizationVersion: 8,
    }),
    record({
      intent: 'claim-organization-owner',
      userId: 'user-1',
      characterId: null,
      organizationId: 98_000_001,
      organizationVersion: 8,
    }),
    record({
      intent: 'claim-organization-owner',
      userId: 'user-1',
      characterId: 90_000_001,
      organizationId: null,
      organizationVersion: 8,
    }),
    record({
      intent: 'claim-organization-owner',
      userId: 'user-1',
      characterId: 90_000_001,
      organizationId: 98_000_001,
      organizationVersion: null,
    }),
    record({
      intent: 'transfer',
      transferApprovalId: null,
      transferSourceUserId: 'source-user-1',
      transferSourceSubjectLifecycleId: 'lifecycle-1',
      userId: 'user-1',
      characterId: 90_000_001,
    }),
    record({
      intent: 'transfer',
      transferApprovalId: 'approval-1',
      transferSourceUserId: null,
      transferSourceSubjectLifecycleId: 'lifecycle-1',
      userId: 'user-1',
      characterId: 90_000_001,
    }),
    record({
      intent: 'transfer',
      transferApprovalId: 'approval-1',
      transferSourceUserId: 'source-user-1',
      transferSourceSubjectLifecycleId: null,
      userId: 'user-1',
      characterId: 90_000_001,
    }),
    record({
      intent: 'transfer',
      transferApprovalId: 'approval-1',
      transferSourceUserId: 'source-user-1',
      transferSourceSubjectLifecycleId: 'lifecycle-1',
      userId: null,
      characterId: 90_000_001,
    }),
    record({
      intent: 'transfer',
      transferApprovalId: 'approval-1',
      transferSourceUserId: 'source-user-1',
      transferSourceSubjectLifecycleId: 'lifecycle-1',
      userId: 'user-1',
      characterId: null,
    }),
  ])('rejects an incomplete stored authorization context', async (storedRecord) => {
    mocks.deleteResults.push([storedRecord])

    await expect(consumeOAuthState('state-1')).rejects.toThrow(
      'Stored OAuth state has invalid authorization context',
    )
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

function query(result: unknown[]) {
  const builder: Record<string, unknown> = {}
  // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are awaitable.
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

function record(overrides: Record<string, unknown>) {
  return {
    intent: 'login',
    userId: null,
    characterId: null,
    returnPath: null,
    organizationId: null,
    organizationVersion: null,
    transferApprovalId: null,
    transferSourceUserId: null,
    transferSourceSubjectLifecycleId: null,
    ...overrides,
  }
}
