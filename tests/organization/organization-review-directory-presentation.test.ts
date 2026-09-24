import {
  platformReviewerDirectoryAuditStates,
  platformReviewerDirectoryComplianceStates,
  type PlatformReviewerDirectoryAuditState,
  type PlatformReviewerDirectoryComplianceState,
  type PlatformReviewerDirectoryRow,
} from '@eve-space/platform-module-contract/reviewer-directory'
import { describe, expect, it } from 'vitest'
import {
  formatOrganizationReviewDirectoryDate,
  organizationReviewDirectoryAccess,
  organizationReviewDirectoryAuditStateLabel,
  organizationReviewDirectoryGroupOverflow,
} from '../../app/utils/organization-review-directory-presentation'

const auditStateLabels = {
  'authorization-required': 'Authorization required',
  current: 'Current',
  'never-collected': 'Never collected',
  'not-enabled': 'Not enabled',
  stale: 'Stale',
  unavailable: 'Unavailable',
} satisfies Record<PlatformReviewerDirectoryAuditState, string>

const complianceStateLabels = {
  compliant: 'Compliant',
  pending: 'Registration pending',
  review_required: 'Review required',
  suspended: 'Access suspended',
} satisfies Record<PlatformReviewerDirectoryComplianceState, string>

describe('organization review directory presentation', () => {
  it('localizes compact and exact date labels without changing the canonical ISO value', () => {
    const timestamp = '2026-09-18T16:35:42.123+02:00'

    expect(
      formatOrganizationReviewDirectoryDate(timestamp, { locale: 'en-GB', timeZone: 'UTC' }),
    ).toStrictEqual({
      compactLabel: '18 Sept 2026, 14:35',
      dateTime: timestamp,
      exactLabel: 'Friday, 18 September 2026 at 14:35:42 UTC',
    })
    expect(
      formatOrganizationReviewDirectoryDate(timestamp, { locale: 'en-US', timeZone: 'UTC' })
        .compactLabel,
    ).toBe('Sep 18, 2026, 2:35 PM')
  })

  it.each([
    { compactLabel: 'Not recorded', timestamp: null },
    { compactLabel: 'Unavailable', timestamp: 'not-a-date' },
  ])('does not fabricate a datetime for $timestamp', ({ timestamp, compactLabel }) => {
    expect(formatOrganizationReviewDirectoryDate(timestamp)).toStrictEqual({
      compactLabel,
      dateTime: null,
      exactLabel: null,
    })
  })

  it('labels every aggregate audit state', () => {
    expect(
      Object.fromEntries(
        platformReviewerDirectoryAuditStates.map((state) => [
          state,
          organizationReviewDirectoryAuditStateLabel(state),
        ]),
      ),
    ).toStrictEqual(auditStateLabels)
  })

  it.each(platformReviewerDirectoryComplianceStates)(
    'presents the %s compliance state as human-readable text',
    (state) => {
      expect(organizationReviewDirectoryAccess(state, { blocked: false })).toStrictEqual({
        label: complianceStateLabels[state],
        state,
      })
    },
  )

  it.each(platformReviewerDirectoryComplianceStates)(
    'gives an active block precedence over the %s compliance state',
    (state) => {
      expect(
        organizationReviewDirectoryAccess(state, {
          blocked: true,
          blockedAt: '2026-09-18T14:35:42.000Z',
        }),
      ).toStrictEqual({ label: 'Access blocked', state: 'blocked' })
    },
  )

  it.each([
    { remainingCount: 4, visibleCount: 0, visibleLimit: 0 },
    { remainingCount: 2, visibleCount: 2, visibleLimit: 2 },
    { remainingCount: 0, visibleCount: 4, visibleLimit: 4 },
    { remainingCount: 0, visibleCount: 4, visibleLimit: 6 },
  ])(
    'shows $visibleCount groups and reports $remainingCount remaining for a $visibleLimit limit',
    ({ remainingCount, visibleCount, visibleLimit }) => {
      const groups = directoryGroups()
      const result = organizationReviewDirectoryGroupOverflow(groups, visibleLimit)

      expect(result.visibleGroups).toStrictEqual(groups.slice(0, visibleCount))
      expect(result.remainingCount).toBe(remainingCount)
      expect(groups.map(({ name }) => name)).toStrictEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
    },
  )

  it('uses a bounded default without reordering or mutating canonical groups', () => {
    const groups = directoryGroups()

    const result = organizationReviewDirectoryGroupOverflow(groups)

    expect(result.visibleGroups.map(({ name }) => name)).toStrictEqual(['Alpha', 'Bravo'])
    expect(result.remainingCount).toBe(2)
    expect(groups.map(({ name }) => name)).toStrictEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
  })
})

function directoryGroups(): PlatformReviewerDirectoryRow['groups'] {
  return Object.freeze([
    { groupId: 'group-alpha', name: 'Alpha' },
    { groupId: 'group-bravo', name: 'Bravo' },
    { groupId: 'group-charlie', name: 'Charlie' },
    { groupId: 'group-delta', name: 'Delta' },
  ])
}
