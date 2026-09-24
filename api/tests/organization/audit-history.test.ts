import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  limit: vi.fn(),
  rows: [] as Record<string, unknown>[],
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
    expect(result).toStrictEqual({
      events: [
        expect.objectContaining({
          auditSequence: '9',
          entitlementExpiresAt: '2026-09-10T12:00:00.000Z',
          eventType: 'exception.approved',
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
      listCurrentOrganizationAuditHistory({ beforeAuditSequence: 8n, limit: 10 }),
    ).resolves.toMatchObject({ nextBeforeAuditSequence: null })
  })

  test('projects bounded sensitive access context without content', async () => {
    mocks.rows = [
      {
        ...event(7n),
        disclosureVersion: 3,
        eventType: 'sensitive-access.decided',
        sectionId: 'mail',
        targetCharacterId: 90_000_001,
      },
    ]

    const result = await listCurrentOrganizationAuditHistory({ limit: 10 })

    expect(result.events[0]).toMatchObject({
      disclosureVersion: 3,
      sectionId: 'mail',
      targetCharacterId: 90_000_001,
    })
    expect(result.events[0]).not.toHaveProperty('query')
    expect(result.events[0]).not.toHaveProperty('evidence')
  })
})

function event(auditSequence: bigint) {
  return {
    actorId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
    actorType: 'user' as const,
    assignmentId: null,
    assignmentSource: null,
    auditId: '35acd527-9539-44ad-aacf-9f8e45232267',
    auditSequence,
    causationAuditId: null,
    complianceSource: null,
    disclosureVersion: null,
    entitlementExpiresAt: new Date('2026-09-10T12:00:00.000Z'),
    eventType: 'exception.approved' as const,
    groupId: null,
    occurredAt: new Date('2026-09-08T12:00:00.000Z'),
    organizationVersion: 1,
    outcome: 'granted' as const,
    policyVersion: 2,
    reason: 'Approved external character.',
    sectionId: null,
    subjectId: '22c7e94c-9cd3-4dc0-a3af-43117426ebec',
    subjectType: 'exception' as const,
    targetCharacterId: null,
    targetUserId: null,
  }
}

function query() {
  const builder: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'orderBy']) {
    builder[method] = () => builder
  }
  builder.limit = (limit: number) => {
    mocks.limit(limit)
    return Promise.resolve(mocks.rows)
  }
  return builder
}
