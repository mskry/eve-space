import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  insertResults: [] as unknown[][],
  updateResults: [] as unknown[][],
  appendAudit: vi.fn(),
  appendAudits: vi.fn(),
  recompute: vi.fn(),
  hasComplianceAccess: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('../../src/db/client.js', () => ({
  db: {
    select: vi.fn(() => query(mocks.selectResults.shift() ?? [])),
    transaction: mocks.transaction,
  },
}))
vi.mock('../../src/organization/audit.js', () => ({
  appendOrganizationAuditEvent: mocks.appendAudit,
  appendOrganizationAuditEvents: mocks.appendAudits,
}))
vi.mock('../../src/organization/compliance.js', () => ({
  recomputeOrganizationAccountCompliance: mocks.recompute,
}))
vi.mock('../../src/organization/compliance-access.js', () => ({
  hasCurrentComplianceAccess: mocks.hasComplianceAccess,
}))

import {
  approveOrganizationCharacterException,
  expireOrganizationCharacterException,
  expireOrganizationCharacterExceptions,
  listCurrentOrganizationCharacterExceptions,
  revokeOrganizationCharacterException,
} from '../../src/organization/exception-store.js'

const actorUserId = '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c'
const userId = '83a37bca-f39b-4424-812a-1228280b434f'
const exceptionId = 'exception-1'

describe('organization character exception store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectResults.length = 0
    mocks.insertResults.length = 0
    mocks.updateResults.length = 0
    mocks.appendAudit.mockResolvedValue(undefined)
    mocks.appendAudits.mockResolvedValue(undefined)
    mocks.recompute.mockResolvedValue({ outcome: 'updated' })
    mocks.hasComplianceAccess.mockResolvedValue(true)
    mocks.transaction.mockImplementation(async (operation) => operation(transaction()))
  })

  test('lists exceptions through the current organization version', async () => {
    const rows = [{ exceptionId }]
    mocks.selectResults.push(rows)

    await expect(listCurrentOrganizationCharacterExceptions()).resolves.toEqual(rows)
  })

  test('approves an external character exception and recomputes compliance', async () => {
    const now = Date.now()
    const exception = { exceptionId, userId, characterId: 90_000_001 }
    mocks.selectResults.push(
      [organization()],
      [{ grantId: 'grant-1' }],
      [],
      [{ userId }],
      [
        {
          corporationId: 98_000_002,
          affiliationCheckedAt: new Date(now - 1000),
          nextAffiliationCheck: new Date(now + 60_000),
          affiliationResolutionState: 'resolved',
        },
      ],
      [],
      [],
    )
    mocks.insertResults.push([exception])

    await expect(
      approveOrganizationCharacterException({
        actorUserId,
        userId,
        characterId: 90_000_001,
        reason: 'Approved external character',
        expiresAt: new Date(now + 120_000),
      }),
    ).resolves.toEqual(exception)
    expect(mocks.appendAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'exception.approved', subjectId: exceptionId }),
    )
    expect(mocks.recompute).toHaveBeenCalledWith(
      expect.objectContaining({ organizationVersion: 8, userId }),
      expect.anything(),
    )
  })

  test('refuses mutation authority when the HR actor is not currently compliant', async () => {
    mocks.hasComplianceAccess.mockResolvedValue(false)
    mocks.selectResults.push([organization()])

    await expect(
      approveOrganizationCharacterException({
        actorUserId,
        userId,
        characterId: 90_000_001,
        reason: 'Cannot bypass suspended access',
        expiresAt: null,
      }),
    ).rejects.toMatchObject({ code: 'hr-authority-required' })
  })

  test('revokes an active exception and recomputes its account', async () => {
    const exception = { exceptionId, userId }
    mocks.selectResults.push(
      [organization()],
      [{ grantId: 'grant-1' }],
      [],
      [{ userId }],
      [{ id: userId }],
    )
    mocks.updateResults.push([exception])

    await expect(
      revokeOrganizationCharacterException({
        actorUserId,
        exceptionId,
        reason: 'No longer required',
      }),
    ).resolves.toEqual(exception)
    expect(mocks.appendAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'exception.revoked' }),
    )
    expect(mocks.recompute).toHaveBeenCalledOnce()
  })

  test('explicitly expires an active exception after its approval instant', async () => {
    const approvedAt = new Date(Date.now() + 60_000)
    const exception = { exceptionId, userId }
    mocks.selectResults.push(
      [organization()],
      [{ grantId: 'grant-1' }],
      [],
      [{ userId, approvedAt }],
      [{ id: userId }],
    )
    mocks.updateResults.push([exception])

    await expect(
      expireOrganizationCharacterException({
        actorUserId,
        exceptionId,
        reason: 'Manual expiry',
      }),
    ).resolves.toEqual(exception)
    expect(mocks.appendAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'exception.expired', reason: 'Manual expiry' }),
    )
  })

  test('expires due exceptions in stable account order and audits each transition', async () => {
    const now = new Date('2026-09-01T12:00:00.000Z')
    const expired = [
      { exceptionId: 'exception-2', userId },
      { exceptionId: 'exception-1', userId: actorUserId },
    ]
    mocks.selectResults.push([organization()], expired, expired)
    mocks.updateResults.push(expired)

    await expect(expireOrganizationCharacterExceptions(now, 5000)).resolves.toEqual(expired)
    expect(mocks.appendAudits).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({ eventType: 'exception.expired', actorType: 'system' }),
      ]),
    )
    expect(mocks.recompute).toHaveBeenCalledTimes(2)
    expect(mocks.recompute.mock.calls.map(([input]) => input.userId)).toEqual([actorUserId, userId])
  })

  test('returns immediately when no exceptions are due', async () => {
    mocks.selectResults.push([organization()], [])

    await expect(expireOrganizationCharacterExceptions()).resolves.toEqual([])
    expect(mocks.appendAudits).not.toHaveBeenCalled()
  })
})

function organization() {
  return {
    organizationVersion: 8,
    policyVersion: 3,
    organizationType: 'corporation',
  }
}

function transaction() {
  return {
    select: vi.fn(() => query(mocks.selectResults.shift() ?? [])),
    insert: vi.fn(() => insertQuery(mocks.insertResults.shift() ?? [])),
    update: vi.fn(() => updateQuery(mocks.updateResults.shift() ?? [])),
  }
}

function query(result: unknown[]) {
  const builder: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit', 'for']) {
    builder[method] = () => builder
  }
  // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are awaitable.
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

function insertQuery(result: unknown[]) {
  const builder = query(result)
  builder.values = () => builder
  builder.returning = () => builder
  return builder
}

function updateQuery(result: unknown[]) {
  const builder = query(result)
  builder.set = () => builder
  builder.returning = () => builder
  return builder
}
