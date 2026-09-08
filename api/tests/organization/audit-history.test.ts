import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  limit: vi.fn(),
}))

vi.mock('../../src/db/client.js', () => ({
  db: {
    select: vi.fn(() => query()),
  },
}))

import { listCurrentOrganizationAuditHistory } from '../../src/organization/audit-history.js'

describe('organization audit history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rows = []
  })

  test('returns a bounded secret-free current-version page', async () => {
    mocks.rows = [event(9n), event(8n)]

    const result = await listCurrentOrganizationAuditHistory({ limit: 1 })

    expect(mocks.limit).toHaveBeenCalledWith(2)
    expect(result).toEqual({
      events: [
        expect.objectContaining({
          auditSequence: '9',
          eventType: 'exception.approved',
          entitlementExpiresAt: '2026-09-10T12:00:00.000Z',
          occurredAt: '2026-09-08T12:00:00.000Z',
        }),
      ],
      nextBeforeAuditSequence: '9',
    })
    expect(result.events[0]).not.toHaveProperty('accessToken')
    expect(result.events[0]).not.toHaveProperty('assets')
    expect(result.events[0]).not.toHaveProperty('characterId')
    expect(result.events[0]).not.toHaveProperty('rawEsiResponse')
    expect(result.events[0]).not.toHaveProperty('wallet')
  })

  test('ends pagination when no additional row exists', async () => {
    mocks.rows = [event(7n)]

    await expect(
      listCurrentOrganizationAuditHistory({ limit: 10, beforeAuditSequence: 8n }),
    ).resolves.toMatchObject({ nextBeforeAuditSequence: null })
  })
})

function event(auditSequence: bigint) {
  return {
    auditId: '35acd527-9539-44ad-aacf-9f8e45232267',
    auditSequence,
    organizationVersion: 1,
    policyVersion: 2,
    eventType: 'exception.approved' as const,
    actorType: 'user' as const,
    actorId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
    subjectType: 'exception' as const,
    subjectId: '22c7e94c-9cd3-4dc0-a3af-43117426ebec',
    reason: 'Approved external character.',
    outcome: 'granted' as const,
    groupId: null,
    assignmentId: null,
    targetUserId: null,
    assignmentSource: null,
    complianceSource: null,
    entitlementExpiresAt: new Date('2026-09-10T12:00:00.000Z'),
    causationAuditId: null,
    occurredAt: new Date('2026-09-08T12:00:00.000Z'),
  }
}

function query() {
  const builder: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'orderBy']) builder[method] = () => builder
  builder.limit = (limit: number) => {
    mocks.limit(limit)
    return Promise.resolve(mocks.rows)
  }
  return builder
}
