import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  affectedUsers: [] as { userId: string }[],
  appendAudit: vi.fn(),
  appendAudits: vi.fn(),
  appendEvent: vi.fn(),
  convergeGroups: vi.fn(),
  convergeManagedMemberLifecycle: vi.fn(),
  deletes: 0,
  inserts: [] as unknown[],
  selectResults: [] as unknown[][],
  services: [] as { permissionKey: string; reviewAllowed?: boolean }[],
}))

vi.mock('../../src/db/client.js', () => ({
  db: {
    selectDistinct: vi.fn(() => query(mocks.affectedUsers)),
    transaction: vi.fn(async (callback: (transaction: unknown) => unknown) =>
      callback(transaction()),
    ),
  },
}))
vi.mock('../../src/organization/audit.js', () => ({
  appendOrganizationAuditEvent: mocks.appendAudit,
  appendOrganizationAuditEvents: mocks.appendAudits,
}))
vi.mock('../../src/domain-events/store.js', () => ({ appendDomainEvent: mocks.appendEvent }))
vi.mock('../../src/organization/group-compliance.js', () => ({
  convergeRegistrationComplianceGroupsInTransaction: mocks.convergeGroups,
}))
vi.mock('../../src/organization/managed-member-lifecycle.js', () => ({
  convergeManagedMemberLifecycleInTransaction: mocks.convergeManagedMemberLifecycle,
}))

import {
  recomputeComplianceForManagedCorporation,
  recomputeOrganizationAccountCompliance,
} from '../../src/organization/compliance.js'

const userId = '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c'
const now = new Date('2026-09-01T12:00:00.000Z')
const evidenceAt = new Date('2026-09-01T11:55:00.000Z')

describe('organization compliance persistence', () => {
  beforeEach(() => {
    mocks.selectResults.length = 0
    mocks.affectedUsers.length = 0
    mocks.services.length = 0
    mocks.inserts.length = 0
    mocks.deletes = 0
    mocks.appendAudit.mockReset().mockResolvedValue(undefined)
    mocks.appendAudits.mockReset().mockResolvedValue([])
    mocks.appendEvent.mockReset().mockResolvedValue(undefined)
    mocks.convergeGroups.mockReset().mockResolvedValue(undefined)
    mocks.convergeManagedMemberLifecycle.mockReset().mockResolvedValue(undefined)
  })

  test('ignores users or organization versions that are no longer current', async () => {
    mocks.selectResults.push([])
    await expect(recompute()).resolves.toStrictEqual({ outcome: 'obsolete' })

    mocks.selectResults.push([{ organizationVersion: 4 }], [])
    await expect(recompute()).resolves.toStrictEqual({ outcome: 'obsolete' })
    expect(mocks.inserts).toHaveLength(0)
  })

  test('persists and emits only a material compliance transition', async () => {
    givenEvaluationState({ previous: [] })
    await expect(recompute()).resolves.toMatchObject({
      evaluation: { evidenceFreshness: 'fresh', issues: [], state: 'compliant' },
      outcome: 'changed',
    })
    expect(mocks.inserts).toHaveLength(1)
    expect(mocks.deletes).toBe(1)
    expect(mocks.convergeManagedMemberLifecycle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eligible: true, userId }),
    )
    expect(mocks.appendAudit).toHaveBeenCalledOnce()
    expect(mocks.appendEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        aggregateId: userId,
        payload: expect.objectContaining({ state: 'compliant', userId }),
        type: 'organization.compliance-transitioned',
      }),
    )

    mocks.inserts.length = 0
    mocks.deletes = 0
    mocks.appendAudit.mockClear()
    mocks.appendEvent.mockClear()
    givenEvaluationState({
      previous: [
        {
          ...compliantProjection(),
          accessValidUntil: new Date('2028-09-01T12:15:00.000Z'),
        },
      ],
    })
    await expect(recompute()).resolves.toMatchObject({ outcome: 'unchanged' })
    expect(mocks.appendAudit).not.toHaveBeenCalled()
    expect(mocks.appendEvent).not.toHaveBeenCalled()
  })

  test('reconciles normalized violations while preserving their first observation', async () => {
    const firstObservedAt = new Date('2026-09-01T11:30:00.000Z')
    givenEvaluationState({
      corporationId: 98_000_002,
      previous: [compliantProjection()],
      previousIssues: [
        {
          characterId: 1_404_328_063,
          firstObservedAt,
          issueCode: 'character-outside-managed-organization',
          issueKey: 'character:1404328063:external',
          lastObservedAt: firstObservedAt,
          requiredScope: null,
        },
      ],
    })

    await expect(recompute()).resolves.toMatchObject({
      evaluation: { reviewDeadline: firstObservedAt, state: 'suspended' },
      outcome: 'changed',
    })
    expect(mocks.inserts).toHaveLength(2)
    expect(mocks.deletes).toBe(1)
  })

  test('links external-service revocation audits to the compliance transition', async () => {
    const auditId = 'cb05479f-36dd-4ec5-91a6-0b90cb8a1149'
    mocks.appendAudit.mockResolvedValue({ auditId })
    mocks.services.push({ permissionKey: 'discord.member' })
    givenEvaluationState({ corporationId: 98_000_002, previous: [compliantProjection()] })

    await expect(recompute()).resolves.toMatchObject({
      evaluation: { state: 'suspended' },
      outcome: 'changed',
    })
    expect(mocks.appendAudits).toHaveBeenCalledWith(expect.anything(), [
      expect.objectContaining({
        causationAuditId: auditId,
        eventType: 'entitlement.revoked',
        subjectId: 'discord.member',
        subjectType: 'external_service',
      }),
    ])
  })

  test('audits effective service-key differences when review flags overlap', async () => {
    mocks.appendAudit.mockResolvedValue({ auditId: 'review-transition' })
    mocks.services.push(
      { permissionKey: 'discord.member', reviewAllowed: false },
      { permissionKey: 'discord.member', reviewAllowed: true },
      { permissionKey: 'discord.leadership', reviewAllowed: false },
    )
    givenEvaluationState({
      corporationId: 98_000_002,
      previous: [compliantProjection()],
      strictRemediationDurationSeconds: 3600,
    })

    await expect(recompute()).resolves.toMatchObject({
      evaluation: { state: 'review_required' },
      outcome: 'changed',
    })
    expect(mocks.appendAudits).toHaveBeenCalledWith(expect.anything(), [
      expect.objectContaining({ subjectId: 'discord.leadership' }),
    ])
  })

  test('audits all restored services when remediation follows expired review access', async () => {
    mocks.appendAudit.mockResolvedValue({ auditId: 'remediation-transition' })
    mocks.services.push(
      { permissionKey: 'discord.member', reviewAllowed: true },
      { permissionKey: 'discord.leadership', reviewAllowed: false },
    )
    givenEvaluationState({
      previous: [
        {
          ...compliantProjection(),
          accessValidUntil: new Date('2026-09-01T11:00:00.000Z'),
          reviewDeadline: new Date('2026-09-01T11:00:00.000Z'),
          state: 'review_required',
        },
      ],
    })

    await expect(recompute()).resolves.toMatchObject({
      evaluation: { state: 'compliant' },
      outcome: 'changed',
    })
    expect(mocks.appendAudits).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({ subjectId: 'discord.member' }),
        expect.objectContaining({ subjectId: 'discord.leadership' }),
      ]),
    )
  })

  test('audits delayed revocation after compliant access expires', async () => {
    mocks.appendAudit.mockResolvedValue({ auditId: 'expired-compliance-transition' })
    mocks.services.push(
      { permissionKey: 'discord.member', reviewAllowed: true },
      { permissionKey: 'discord.leadership', reviewAllowed: false },
    )
    givenEvaluationState({
      corporationId: 98_000_002,
      previous: [
        {
          ...compliantProjection(),
          accessValidUntil: new Date('2026-09-01T11:00:00.000Z'),
        },
      ],
    })

    await expect(recompute()).resolves.toMatchObject({
      evaluation: { state: 'suspended' },
      outcome: 'changed',
    })
    expect(mocks.appendAudits).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({ subjectId: 'discord.member' }),
        expect.objectContaining({ subjectId: 'discord.leadership' }),
      ]),
    )
  })

  test('revokes only non-review services when expired compliant access enters review', async () => {
    mocks.appendAudit.mockResolvedValue({ auditId: 'expired-review-transition' })
    mocks.services.push(
      { permissionKey: 'discord.member', reviewAllowed: true },
      { permissionKey: 'discord.leadership', reviewAllowed: false },
    )
    givenEvaluationState({
      corporationId: 98_000_002,
      previous: [
        {
          ...compliantProjection(),
          accessValidUntil: new Date('2026-09-01T11:00:00.000Z'),
        },
      ],
      strictRemediationDurationSeconds: 3600,
    })

    await expect(recompute()).resolves.toMatchObject({
      evaluation: { state: 'review_required' },
      outcome: 'changed',
    })
    expect(mocks.appendAudits).toHaveBeenCalledTimes(1)
    expect(mocks.appendAudits).toHaveBeenCalledWith(expect.anything(), [
      expect.objectContaining({
        eventType: 'entitlement.revoked',
        subjectId: 'discord.leadership',
      }),
    ])
  })

  test('recomputes each disclosed user currently affiliated with a changed corporation', async () => {
    mocks.affectedUsers.push({ userId })
    givenEvaluationState({ previous: [] })

    await expect(
      recomputeComplianceForManagedCorporation({
        corporationId: 98_000_001,
        deploymentId: 1,
        organizationVersion: 4,
      }),
    ).resolves.toBeUndefined()
    expect(mocks.inserts).toHaveLength(1)
  })

  test('ends managed-member eligibility when alliance authority is stale', async () => {
    givenEvaluationState({
      managedCollectionRows: [
        {
          validatedAt: evidenceAt,
          nextEligibleAt: new Date('2026-09-01T11:59:00.000Z'),
          lastFailureClass: null,
          failureStartedAt: null,
        },
      ],
      organizationType: 'alliance',
      previous: [],
    })

    await recompute()

    expect(mocks.convergeManagedMemberLifecycle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eligible: false, userId }),
    )
  })
})

function recompute() {
  return recomputeOrganizationAccountCompliance({
    deploymentId: 1,
    now,
    organizationVersion: 4,
    userId,
  })
}

function givenEvaluationState(input: {
  corporationId?: number
  organizationType?: 'alliance' | 'corporation'
  managedCollectionRows?: unknown[]
  previous: unknown[]
  previousIssues?: unknown[]
  strictRemediationDurationSeconds?: number
}) {
  mocks.selectResults.push(
    [
      {
        organizationType: input.organizationType ?? 'corporation',
        organizationVersion: 4,
        policyVersion: 2,
        requiredScopes: [],
        staleEvidenceGraceDurationSeconds: 3600,
        strictRemediationDurationSeconds: input.strictRemediationDurationSeconds ?? 0,
      },
    ],
    [{ userId }],
    [
      {
        affiliationCheckedAt: evidenceAt,
        affiliationResolutionState: 'resolved',
        characterId: 1_404_328_063,
        corporationId: input.corporationId ?? 98_000_001,
        nextAffiliationCheck: new Date('2027-09-01T12:15:00.000Z'),
        scopes: [],
      },
    ],
    [{ corporationId: 98_000_001 }],
    input.managedCollectionRows ?? [],
    [],
    input.previous,
    input.previousIssues ?? [],
  )
}

function compliantProjection() {
  return {
    accessValidUntil: new Date('2027-09-01T12:15:00.000Z'),
    authoritative: true,
    createdAt: now,
    deploymentId: 1,
    establishedCompliantAt: now,
    evaluatedAt: now,
    evidenceAt,
    evidenceFreshness: 'fresh',
    invalidatedAt: null,
    organizationVersion: 4,
    reviewDeadline: null,
    state: 'compliant',
    updatedAt: now,
    userId,
  }
}

function transaction() {
  return {
    delete() {
      mocks.deletes += 1
      return query([])
    },
    insert() {
      const values: unknown[] = []
      mocks.inserts.push(values)
      return query([], values)
    },
    select() {
      return query(mocks.selectResults.shift() ?? [])
    },
    selectDistinct() {
      return query(mocks.services)
    },
  }
}

function query(result: unknown[], insertedValues?: unknown[]) {
  const builder: Record<string, unknown> = {}
  for (const method of [
    'from',
    'leftJoin',
    'innerJoin',
    'where',
    'limit',
    'for',
    'orderBy',
    'onConflictDoUpdate',
  ]) {
    builder[method] = () => builder
  }
  builder.values = (values: unknown) => {
    insertedValues?.push(values)
    return builder
  }
  // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are awaitable.
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}
