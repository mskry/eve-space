import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  affectedUsers: [] as { userId: string }[],
  inserts: [] as unknown[],
  deletes: 0,
  appendAudit: vi.fn(),
  appendEvent: vi.fn(),
}))

vi.mock('../../src/db/client.js', () => ({
  db: {
    transaction: vi.fn(async (callback: (transaction: unknown) => unknown) =>
      callback(transaction()),
    ),
    selectDistinct: vi.fn(() => query(mocks.affectedUsers)),
  },
}))
vi.mock('../../src/organization/audit.js', () => ({
  appendOrganizationAuditEvent: mocks.appendAudit,
}))
vi.mock('../../src/domain-events/store.js', () => ({ appendDomainEvent: mocks.appendEvent }))

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
    mocks.inserts.length = 0
    mocks.deletes = 0
    mocks.appendAudit.mockReset().mockResolvedValue(undefined)
    mocks.appendEvent.mockReset().mockResolvedValue(undefined)
  })

  test('ignores users or organization versions that are no longer current', async () => {
    mocks.selectResults.push([])
    await expect(recompute()).resolves.toEqual({ outcome: 'obsolete' })

    mocks.selectResults.push([{ userId }], [])
    await expect(recompute()).resolves.toEqual({ outcome: 'obsolete' })
    expect(mocks.inserts).toHaveLength(0)
  })

  test('persists and emits only a material compliance transition', async () => {
    givenEvaluationState({ previous: [] })
    await expect(recompute()).resolves.toMatchObject({
      outcome: 'changed',
      evaluation: { state: 'compliant', evidenceFreshness: 'fresh', issues: [] },
    })
    expect(mocks.inserts).toHaveLength(1)
    expect(mocks.deletes).toBe(1)
    expect(mocks.appendAudit).toHaveBeenCalledOnce()
    expect(mocks.appendEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'organization.compliance-transitioned',
        aggregateId: userId,
        payload: expect.objectContaining({ state: 'compliant', userId }),
      }),
    )

    mocks.inserts.length = 0
    mocks.deletes = 0
    mocks.appendAudit.mockClear()
    mocks.appendEvent.mockClear()
    givenEvaluationState({ previous: [compliantProjection()] })
    await expect(recompute()).resolves.toMatchObject({ outcome: 'unchanged' })
    expect(mocks.appendAudit).not.toHaveBeenCalled()
    expect(mocks.appendEvent).not.toHaveBeenCalled()
  })

  test('reconciles normalized violations while preserving their first observation', async () => {
    const firstObservedAt = new Date('2026-09-01T11:30:00.000Z')
    givenEvaluationState({
      corporationId: 98000002,
      previous: [compliantProjection()],
      previousIssues: [
        {
          issueKey: 'character:1404328063:external',
          issueCode: 'character-outside-managed-organization',
          characterId: 1404328063,
          requiredScope: null,
          firstObservedAt,
          lastObservedAt: firstObservedAt,
        },
      ],
    })

    await expect(recompute()).resolves.toMatchObject({
      outcome: 'changed',
      evaluation: { state: 'suspended', reviewDeadline: firstObservedAt },
    })
    expect(mocks.inserts).toHaveLength(2)
    expect(mocks.deletes).toBe(1)
  })

  test('recomputes each disclosed user currently affiliated with a changed corporation', async () => {
    mocks.affectedUsers.push({ userId })
    givenEvaluationState({ previous: [] })

    await expect(
      recomputeComplianceForManagedCorporation({
        deploymentId: 1,
        organizationVersion: 4,
        corporationId: 98000001,
      }),
    ).resolves.toBeUndefined()
    expect(mocks.inserts).toHaveLength(1)
  })
})

function recompute() {
  return recomputeOrganizationAccountCompliance({
    deploymentId: 1,
    organizationVersion: 4,
    userId,
    now,
  })
}

function givenEvaluationState(input: {
  corporationId?: number
  previous: unknown[]
  previousIssues?: unknown[]
}) {
  mocks.selectResults.push(
    [{ userId }],
    [
      {
        organizationVersion: 4,
        organizationType: 'corporation',
        policyVersion: 2,
        requiredScopes: [],
        strictRemediationDurationSeconds: 0,
        staleEvidenceGraceDurationSeconds: 3600,
      },
    ],
    [
      {
        characterId: 1404328063,
        corporationId: input.corporationId ?? 98000001,
        affiliationCheckedAt: evidenceAt,
        nextAffiliationCheck: new Date('2027-09-01T12:15:00.000Z'),
        affiliationResolutionState: 'resolved',
        scopes: [],
      },
    ],
    [{ corporationId: 98000001 }],
    [],
    [],
    input.previous,
    input.previousIssues ?? [],
  )
}

function compliantProjection() {
  return {
    deploymentId: 1,
    organizationVersion: 4,
    userId,
    state: 'compliant',
    evidenceFreshness: 'fresh',
    evidenceAt,
    reviewDeadline: null,
    establishedCompliantAt: now,
    authoritative: true,
    invalidatedAt: null,
    evaluatedAt: now,
    createdAt: now,
    updatedAt: now,
  }
}

function transaction() {
  return {
    select() {
      return query(mocks.selectResults.shift() ?? [])
    },
    insert() {
      const values: unknown[] = []
      mocks.inserts.push(values)
      return query([], values)
    },
    delete() {
      mocks.deletes += 1
      return query([])
    },
  }
}

function query(result: unknown[], insertedValues?: unknown[]) {
  const builder: Record<string, unknown> = {}
  for (const method of ['from', 'leftJoin', 'innerJoin', 'where', 'for', 'onConflictDoUpdate'])
    builder[method] = () => builder
  builder.values = (values: unknown) => {
    insertedValues?.push(values)
    return builder
  }
  // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are awaitable.
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}
