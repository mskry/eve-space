import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  dbSelectResults: [] as unknown[][],
  findCharacterDetachmentBlocker: vi.fn(),
  hashToken: vi.fn(),
  insert: vi.fn(),
  insertResults: [] as unknown[][],
  insertValues: [] as unknown[],
  loadDatabaseWallClock: vi.fn(),
  lockCharacter: vi.fn(),
  lockCurrentOrganizationVersionForCompliance: vi.fn(),
  lockTransferUsers: vi.fn(),
  setAuthTransactionLockTimeout: vi.fn(),
  tokensMatch: vi.fn(),
  transactionDelete: vi.fn(),
  transactionInsert: vi.fn(),
  transactionSelect: vi.fn(),
  transactionSelectResults: [] as unknown[][],
  transactionUpdate: vi.fn(),
  transactionUpdateResults: [] as unknown[][],
  transactionValues: [] as unknown[],
  update: vi.fn(),
}))

const transaction = {
  delete: mocks.transactionDelete,
  insert: mocks.transactionInsert,
  select: mocks.transactionSelect,
  update: mocks.transactionUpdate,
}

vi.mock('../../src/db/client.js', () => ({
  db: {
    select: mocks.dbSelect,
    transaction: async (operation: (activeTransaction: typeof transaction) => Promise<unknown>) =>
      operation(transaction),
  },
}))

vi.mock('../../src/organization/compliance.js', () => ({
  lockCurrentOrganizationVersionForCompliance: mocks.lockCurrentOrganizationVersionForCompliance,
}))

vi.mock('../../src/organization/character-detachment-guards.js', () => ({
  findCharacterDetachmentBlocker: mocks.findCharacterDetachmentBlocker,
}))

vi.mock('../../src/auth/character-lock.js', () => ({
  lockCharacter: mocks.lockCharacter,
  setAuthTransactionLockTimeout: mocks.setAuthTransactionLockTimeout,
}))

vi.mock('../../src/auth/security.js', () => ({
  createOpaqueToken: () => 'approval-secret',
  hashToken: mocks.hashToken,
  tokensMatch: mocks.tokensMatch,
}))

vi.mock('../../src/auth/character-transfer-store.js', () => ({
  loadDatabaseWallClock: mocks.loadDatabaseWallClock,
  lockTransferUsers: mocks.lockTransferUsers,
}))

import {
  createCharacterTransferApproval,
  inspectCharacterTransferApproval,
  loadTransferApprovalForStart,
  previewCharacterTransfer,
  revokeCharacterTransferApproval,
} from '../../src/auth/character-transfer-approvals.js'

const now = new Date('2026-09-11T12:00:00.000Z')
const administratorId = 'administrator-1'
const sourceUserId = 'source-user-1'
const destinationUserId = 'destination-user-1'
const characterId = 1_404_328_063
const destinationMainCharacterId = 2_112_625_428

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(now)
  mocks.dbSelectResults.length = 0
  mocks.insertResults.length = 0
  mocks.insertValues.length = 0
  mocks.transactionSelectResults.length = 0
  mocks.transactionUpdateResults.length = 0
  mocks.transactionValues.length = 0
  mocks.dbSelect.mockImplementation(() => selectQuery(mocks.dbSelectResults.shift() ?? []))
  mocks.transactionSelect.mockImplementation(() =>
    selectQuery(mocks.transactionSelectResults.shift() ?? []),
  )
  mocks.transactionInsert.mockImplementation(() => insertQuery(mocks.insertResults.shift() ?? []))
  mocks.transactionUpdate.mockImplementation(() =>
    updateQuery(mocks.transactionUpdateResults.shift() ?? []),
  )
  mocks.transactionDelete.mockImplementation(() => deleteQuery())
  mocks.findCharacterDetachmentBlocker.mockResolvedValue(null)
  mocks.hashToken.mockImplementation((secret: string) => `hash:${secret}`)
  mocks.loadDatabaseWallClock.mockResolvedValue(now)
  mocks.lockCharacter.mockResolvedValue(undefined)
  mocks.lockCurrentOrganizationVersionForCompliance.mockResolvedValue(undefined)
  mocks.lockTransferUsers.mockResolvedValue(true)
  mocks.setAuthTransactionLockTimeout.mockResolvedValue(undefined)
  mocks.tokensMatch.mockImplementation((left: string, right: string) => left === right)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('character transfer approvals', () => {
  test('returns null when an approval cannot be inspected', async () => {
    mocks.dbSelectResults.push([])

    await expect(inspectCharacterTransferApproval('missing-approval')).resolves.toBeNull()
    expect(mocks.dbSelect).toHaveBeenCalledOnce()
  })

  test.each([
    [{}, 'pending'],
    [{ revokedAt: new Date('2026-09-11T11:59:00.000Z') }, 'revoked'],
    [{ consumedAt: new Date('2026-09-11T11:59:00.000Z') }, 'consumed'],
    [{ expiresAt: new Date('2026-09-11T11:59:00.000Z') }, 'expired'],
  ] as const)(
    'inspects a %s approval with its ordered audit history',
    async (overrides, status) => {
      mocks.dbSelectResults.push(
        [approval(overrides)],
        [
          {
            action: 'created',
            outcome: 'created',
            reason: 'Repair split account',
            occurredAt: now,
          },
        ],
      )

      const result = await inspectCharacterTransferApproval('approval-1')

      expect(result).toMatchObject({
        approval: { approvalId: 'approval-1', status },
        audit: [{ action: 'created', outcome: 'created' }],
      })
    },
  )

  test('omits private approval bindings and secrets from inspection DTOs', async () => {
    mocks.dbSelectResults.push(
      [approval()],
      [{ action: 'created', outcome: 'created', reason: 'Repair split account', occurredAt: now }],
    )

    await expect(inspectCharacterTransferApproval('approval-1')).resolves.toEqual({
      approval: {
        approvalId: 'approval-1',
        character: { characterId, name: 'Moving Pilot' },
        destinationMain: { characterId: destinationMainCharacterId, name: 'Destination Pilot' },
        sourceCharacterCount: 1,
        reason: 'Repair split account',
        status: 'pending',
        createdAt: now,
        expiresAt: new Date('2026-09-11T12:15:00.000Z'),
        consumedAt: null,
        revokedAt: null,
        revocationReason: null,
      },
      audit: [
        {
          action: 'created',
          outcome: 'created',
          reason: 'Repair split account',
          occurredAt: now,
        },
      ],
    })
  })

  test.each([
    [undefined, 'approval-unavailable'],
    [{ consumedAt: now }, 'approval-consumed'],
    [{ revokedAt: now }, 'approval-revoked'],
    [{ expiresAt: new Date('2026-09-11T11:59:59.000Z') }, 'approval-expired'],
  ] as const)('rejects revocation when the approval is %s', async (overrides, code) => {
    mocks.transactionSelectResults.push(overrides ? [approval(overrides)] : [])

    await expect(revoke()).rejects.toMatchObject({ code })
    expect(mocks.transactionUpdate).not.toHaveBeenCalled()
  })

  test('revokes a pending approval and records the administrator action', async () => {
    const revokedAt = new Date('2026-09-11T12:01:00.000Z')
    mocks.loadDatabaseWallClock.mockResolvedValue(revokedAt)
    mocks.transactionSelectResults.push([approval()])
    mocks.transactionUpdateResults.push([
      approval({
        revokedAt,
        revokedByAdministratorId: administratorId,
        revocationReason: 'Approval no longer needed',
      }),
    ])

    await expect(revoke()).resolves.toMatchObject({
      approvalId: 'approval-1',
      status: 'revoked',
      revokedAt,
      revocationReason: 'Approval no longer needed',
    })
    expect(mocks.insertValues).toContainEqual(
      expect.objectContaining({
        action: 'revoked',
        actionAdministratorId: administratorId,
        occurredAt: revokedAt,
        outcome: 'revoked',
      }),
    )
  })

  test.each([
    [undefined, 'missing approval'],
    [{ destinationUserId: 'other-user' }, 'another destination user'],
    [{ consumedAt: now }, 'already consumed'],
    [{ revokedAt: now }, 'already revoked'],
    [{ linkSecretHash: 'hash:another-secret' }, 'a wrong secret'],
  ] as const)('does not load transfer start bindings for %s', async (overrides, _description) => {
    mocks.transactionSelectResults.push(overrides ? [approval(overrides)] : [])

    await expect(loadForStart()).resolves.toBeNull()
    expect(mocks.loadDatabaseWallClock).not.toHaveBeenCalled()
  })

  test('does not load an expired transfer start binding', async () => {
    mocks.transactionSelectResults.push([approval({ expiresAt: now })])

    await expect(loadForStart()).resolves.toBeNull()
  })

  test.each([
    ['a changed source owner', [{ userId: 'other-user', subjectLifecycleId: 'lifecycle-1' }]],
    [
      'a changed source lifecycle',
      [{ userId: sourceUserId, subjectLifecycleId: 'other-lifecycle' }],
    ],
    ['a missing destination main', [{ userId: sourceUserId, subjectLifecycleId: 'lifecycle-1' }]],
    ['a changed administrator', [{ userId: sourceUserId, subjectLifecycleId: 'lifecycle-1' }]],
  ] as const)('does not load a binding after %s', async (description, source) => {
    mocks.transactionSelectResults.push(
      [approval()],
      [...source],
      description === 'a missing destination main'
        ? []
        : [{ characterId: destinationMainCharacterId }],
      description === 'a changed administrator'
        ? [{ administratorId: 'other-admin' }]
        : [{ administratorId }],
    )

    await expect(loadForStart()).resolves.toBeNull()
  })

  test('loads a valid transfer start binding after revalidating its identities', async () => {
    mocks.transactionSelectResults.push(
      [approval()],
      [{ userId: sourceUserId, subjectLifecycleId: 'lifecycle-1' }],
      [{ characterId: destinationMainCharacterId }],
      [{ administratorId }],
    )

    await expect(loadForStart()).resolves.toEqual({
      approvalId: 'approval-1',
      sourceUserId,
      sourceSubjectLifecycleId: 'lifecycle-1',
      userId: destinationUserId,
      characterId,
    })
    expect(mocks.hashToken).toHaveBeenCalledWith('approval-secret')
  })

  test('returns unavailable when the preview candidate no longer exists', async () => {
    mocks.transactionSelectResults.push([])

    await expect(preview()).resolves.toEqual({ eligible: false, blocker: 'unavailable' })
    expect(mocks.lockCharacter).not.toHaveBeenCalled()
  })

  test('returns an eligibility blocker after locking and reloading candidates', async () => {
    queueCandidates(candidate({ destinationUserId: sourceUserId }))
    queueCandidates(candidate({ destinationUserId: sourceUserId }))

    await expect(preview()).resolves.toMatchObject({
      eligible: false,
      blocker: 'same-account',
      character: { characterId },
    })
    expect(mocks.lockCharacter).toHaveBeenCalledWith(transaction, characterId)
    expect(mocks.lockTransferUsers).toHaveBeenCalledWith(transaction, [sourceUserId, sourceUserId])
  })

  test('stores an eligible transfer preview after rechecking the locked candidates', async () => {
    queueCandidates()
    queueCandidates()
    mocks.insertResults.push([
      { previewId: 'preview-1', expiresAt: new Date('2026-09-11T12:05:00.000Z') },
    ])

    await expect(preview()).resolves.toEqual({
      eligible: true,
      previewId: 'preview-1',
      character: { characterId, name: 'Moving Pilot' },
      destinationMain: { characterId: destinationMainCharacterId, name: 'Destination Pilot' },
      sourceCharacterCount: 1,
      expiresAt: new Date('2026-09-11T12:05:00.000Z'),
    })
    expect(mocks.insertValues).toContainEqual(
      expect.objectContaining({
        administratorId,
        characterId,
        destinationUserId,
        expiresAt: new Date('2026-09-11T12:05:00.000Z'),
      }),
    )
  })

  test('rejects creation when the preview is unavailable', async () => {
    mocks.transactionSelectResults.push([])

    await expect(
      createCharacterTransferApproval({ administratorId, previewId: 'preview-1' }),
    ).rejects.toMatchObject({
      code: 'preview-unavailable',
    })
  })

  test('rejects creation when the user locks cannot be acquired', async () => {
    mocks.transactionSelectResults.push([previewRecord()])
    mocks.lockTransferUsers.mockResolvedValue(false)

    await expect(
      createCharacterTransferApproval({ administratorId, previewId: 'preview-1' }),
    ).rejects.toMatchObject({
      code: 'preview-stale',
    })
  })

  test('creates an approval, audit record, and one-time secret from a current preview', async () => {
    mocks.transactionSelectResults.push([previewRecord()], [previewRecord()])
    queueCandidates()
    const storedApproval = approval({ approvalId: 'approval-created', createdAt: now })
    mocks.insertResults.push([storedApproval], [])

    await expect(
      createCharacterTransferApproval({ administratorId, previewId: 'preview-1' }),
    ).resolves.toMatchObject({
      secret: 'approval-secret',
      approval: { approvalId: 'approval-created', status: 'pending' },
    })
    expect(mocks.hashToken).toHaveBeenCalledWith('approval-secret')
    expect(mocks.insertValues).toContainEqual(
      expect.objectContaining({
        linkSecretHash: 'hash:approval-secret',
        approvedByAdministratorId: administratorId,
      }),
    )
    expect(mocks.insertValues).toContainEqual(
      expect.objectContaining({
        action: 'created',
        approvalId: 'approval-created',
        outcome: 'created',
      }),
    )
  })
})

function revoke() {
  return revokeCharacterTransferApproval({
    administratorId,
    approvalId: 'approval-1',
    reason: 'Approval no longer needed',
  })
}

function loadForStart() {
  return loadTransferApprovalForStart({
    approvalId: 'approval-1',
    secret: 'approval-secret',
    destinationUserId,
  })
}

function preview() {
  return previewCharacterTransfer({
    administratorId,
    characterId,
    destinationMainCharacterId,
    reason: 'Repair split account',
  })
}

function approval(overrides: Record<string, unknown> = {}) {
  return {
    approvalId: 'approval-1',
    approvedByAdministratorId: administratorId,
    characterId,
    characterName: 'Moving Pilot',
    consumedAt: null,
    createdAt: now,
    destinationMainCharacterId,
    destinationMainCharacterName: 'Destination Pilot',
    destinationUserId,
    expiresAt: new Date('2026-09-11T12:15:00.000Z'),
    linkSecretHash: 'hash:approval-secret',
    reason: 'Repair split account',
    revokedAt: null,
    revocationReason: null,
    sourceCharacterCount: 1,
    sourceSubjectLifecycleId: 'lifecycle-1',
    sourceUserId,
    ...overrides,
  }
}

function previewRecord(overrides: Record<string, unknown> = {}) {
  return {
    previewId: 'preview-1',
    administratorId,
    characterId,
    characterName: 'Moving Pilot',
    destinationMainCharacterId,
    destinationMainCharacterName: 'Destination Pilot',
    destinationUserId,
    expiresAt: new Date('2026-09-11T12:05:00.000Z'),
    reason: 'Repair split account',
    sourceCharacterCount: 1,
    sourceSubjectLifecycleId: 'lifecycle-1',
    sourceUserId,
    ...overrides,
  }
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    characterId,
    characterName: 'Moving Pilot',
    destinationIsMain: true,
    destinationMainCharacterId,
    destinationMainCharacterName: 'Destination Pilot',
    destinationUserId,
    sourceIsMain: false,
    sourceSubjectLifecycleId: 'lifecycle-1',
    sourceUserId,
    sourceCharacterCount: 1,
    ...overrides,
  }
}

function queueCandidates(overrides: Record<string, unknown> = {}) {
  const value = candidate(overrides)
  mocks.transactionSelectResults.push(
    [
      {
        characterId: value.characterId,
        characterName: value.characterName,
        sourceIsMain: value.sourceIsMain,
        sourceSubjectLifecycleId: value.sourceSubjectLifecycleId,
        sourceUserId: value.sourceUserId,
      },
    ],
    [
      {
        destinationIsMain: value.destinationIsMain,
        destinationMainCharacterId: value.destinationMainCharacterId,
        destinationMainCharacterName: value.destinationMainCharacterName,
        destinationUserId: value.destinationUserId,
      },
    ],
    [{ value: value.sourceCharacterCount }],
  )
}

function selectQuery(result: unknown[]) {
  const builder = awaitableQuery(result)
  builder.from = () => builder
  builder.innerJoin = () => builder
  builder.where = () => builder
  builder.orderBy = () => builder
  builder.for = () => builder
  return builder
}

function insertQuery(result: unknown[]) {
  const builder = awaitableQuery(result)
  builder.values = (value: unknown) => {
    mocks.insertValues.push(value)
    return builder
  }
  builder.returning = () => builder
  return builder
}

function updateQuery(result: unknown[]) {
  const builder = awaitableQuery(result)
  builder.set = (value: unknown) => {
    mocks.transactionValues.push(value)
    return builder
  }
  builder.where = () => builder
  builder.returning = () => builder
  return builder
}

function deleteQuery() {
  const builder = awaitableQuery([])
  builder.where = () => builder
  return builder
}

function awaitableQuery(result: unknown[]) {
  const builder: Record<string, unknown> = {}
  // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are awaitable.
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}
