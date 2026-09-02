import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  recompute: vi.fn(),
}))

vi.mock('../../src/db/client.js', () => ({
  db: { select: vi.fn(() => query(mocks.selectResults.shift() ?? [])) },
}))
vi.mock('../../src/organization/compliance.js', () => ({
  recomputeCurrentOrganizationAccountCompliance: mocks.recompute,
}))

import { getOrganizationAccountComplianceDetails } from '../../src/organization/compliance-details.js'

const userId = '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c'

describe('organization compliance details', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectResults.length = 0
    mocks.recompute.mockResolvedValue({ outcome: 'unchanged' })
  })

  test('maps account and character reasons to intentional remediation actions', async () => {
    const checkedAt = new Date('2026-09-01T10:00:00.000Z')
    const nextCheck = new Date('2026-09-01T11:00:00.000Z')
    mocks.selectResults.push(
      [{ organizationVersion: 4 }],
      [
        {
          state: 'suspended',
          evidenceFreshness: 'stale',
          evidenceAt: checkedAt,
          reviewDeadline: new Date(Date.now() + 60_000),
          accessValidUntil: null,
          evaluatedAt: new Date('2026-09-01T12:00:00.000Z'),
        },
      ],
      [
        {
          characterId: 90_000_001,
          characterName: 'External Pilot',
          affiliationCheckedAt: checkedAt,
          nextAffiliationCheck: nextCheck,
          affiliationResolutionState: 'resolved',
        },
      ],
      [
        { issueCode: 'no-managed-organization-character', characterId: null, requiredScope: null },
        {
          issueCode: 'required-scope-missing',
          characterId: 90_000_001,
          requiredScope: 'esi-wallet.read_character_wallet.v1',
        },
        {
          issueCode: 'character-affiliation-stale',
          characterId: 90_000_001,
          requiredScope: null,
        },
        {
          issueCode: 'character-outside-managed-organization',
          characterId: 90_000_001,
          requiredScope: null,
        },
      ],
    )

    await expect(getOrganizationAccountComplianceDetails(userId)).resolves.toMatchObject({
      organizationVersion: 4,
      state: 'suspended',
      evidenceFreshness: 'stale',
      accountReasons: [{ code: 'no-managed-organization-character' }],
      remediationActions: [{ type: 'attach-managed-character', path: '/auth/eve/attach' }],
      characters: [
        {
          characterId: 90_000_001,
          affiliationFreshness: 'stale',
          reasons: [
            {
              code: 'required-scope-missing',
              requiredScope: 'esi-wallet.read_character_wallet.v1',
            },
            { code: 'character-affiliation-stale', requiredScope: null },
            { code: 'character-outside-managed-organization', requiredScope: null },
          ],
          remediationActions: [
            { type: 'reauthorize-character', path: '/auth/eve/reauthorize/90000001' },
            { type: 'await-affiliation-refresh', path: null },
            { type: 'contact-organization-hr', path: null },
          ],
        },
      ],
    })
    expect(mocks.recompute).not.toHaveBeenCalled()
  })

  test('repairs missing projections and returns pending defaults when convergence stays absent', async () => {
    mocks.selectResults.push([{ organizationVersion: 4 }], [], [], [], [])

    await expect(getOrganizationAccountComplianceDetails(userId)).resolves.toMatchObject({
      organizationVersion: 4,
      state: 'pending',
      evidenceFreshness: 'unavailable',
      evidenceAt: null,
      reviewDeadline: null,
      accessValidUntil: null,
      evaluatedAt: null,
      accountReasons: [],
      remediationActions: [],
      characters: [],
    })
    expect(mocks.recompute).toHaveBeenCalledWith(userId)
  })

  test('repairs review access that expires before the remediation deadline', async () => {
    const reviewDeadline = new Date(Date.now() + 60_000)
    mocks.selectResults.push(
      [{ organizationVersion: 4 }],
      [
        {
          state: 'review_required',
          evidenceFreshness: 'stale',
          evidenceAt: new Date('2026-09-01T10:00:00.000Z'),
          reviewDeadline,
          accessValidUntil: new Date(0),
          evaluatedAt: new Date('2026-09-01T11:00:00.000Z'),
        },
      ],
      [
        {
          state: 'suspended',
          evidenceFreshness: 'stale',
          evidenceAt: new Date('2026-09-01T10:00:00.000Z'),
          reviewDeadline,
          accessValidUntil: null,
          evaluatedAt: new Date('2026-09-01T12:00:00.000Z'),
        },
      ],
      [],
      [],
    )

    await expect(getOrganizationAccountComplianceDetails(userId)).resolves.toMatchObject({
      state: 'suspended',
      accessValidUntil: null,
    })
    expect(mocks.recompute).toHaveBeenCalledOnce()
  })

  test('refuses to fabricate details without a configured organization', async () => {
    mocks.selectResults.push([])

    await expect(getOrganizationAccountComplianceDetails(userId)).rejects.toThrow(
      'Deployment organization is not configured',
    )
  })
})

function query(result: unknown[]) {
  const builder: Record<string, unknown> = {}
  for (const method of ['from', 'where', 'orderBy']) builder[method] = () => builder
  // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query builders are awaitable.
  builder.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}
