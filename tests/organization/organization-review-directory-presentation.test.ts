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
  'not-enabled': 'Not enabled',
  'authorization-required': 'Authorization required',
  unavailable: 'Unavailable',
  'never-collected': 'Never collected',
  stale: 'Stale',
  current: 'Current',
} satisfies Record<PlatformReviewerDirectoryAuditState, string>

const complianceStateLabels = {
  pending: 'Registration pending',
  compliant: 'Compliant',
  review_required: 'Review required',
  suspended: 'Access suspended',
} satisfies Record<PlatformReviewerDirectoryComplianceState, string>

describe('organization review directory presentation', () => {
  it('localizes compact and exact date labels without changing the canonical ISO value', () => {
    const timestamp = '2026-09-18T16:35:42.123+02:00'

    expect(
      formatOrganizationReviewDirectoryDate(timestamp, { locale: 'en-GB', timeZone: 'UTC' }),
    ).toEqual({
      dateTime: timestamp,
      compactLabel: '18 Sept 2026, 14:35',
      exactLabel: 'Friday, 18 September 2026 at 14:35:42 UTC',
    })
    expect(
      formatOrganizationReviewDirectoryDate(timestamp, { locale: 'en-US', timeZone: 'UTC' })
        .compactLabel,
    ).toBe('Sep 18, 2026, 2:35 PM')
  })

  it.each([
    { timestamp: null, compactLabel: 'Not recorded' },
    { timestamp: 'not-a-date', compactLabel: 'Unavailable' },
  ])('does not fabricate a datetime for $timestamp', ({ timestamp, compactLabel }) => {
    expect(formatOrganizationReviewDirectoryDate(timestamp)).toEqual({
      dateTime: null,
      compactLabel,
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
    ).toEqual(auditStateLabels)
  })

  it.each(platformReviewerDirectoryComplianceStates)(
    'presents the %s compliance state as human-readable text',
    (state) => {
      expect(organizationReviewDirectoryAccess(state, { blocked: false })).toEqual({
        state,
        label: complianceStateLabels[state],
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
      ).toEqual({ state: 'blocked', label: 'Access blocked' })
    },
  )

  it.each([
    { visibleLimit: 0, visibleCount: 0, remainingCount: 4 },
    { visibleLimit: 2, visibleCount: 2, remainingCount: 2 },
    { visibleLimit: 4, visibleCount: 4, remainingCount: 0 },
    { visibleLimit: 6, visibleCount: 4, remainingCount: 0 },
  ])(
    'shows $visibleCount groups and reports $remainingCount remaining for a $visibleLimit limit',
    ({ remainingCount, visibleCount, visibleLimit }) => {
      const groups = directoryGroups()
      const result = organizationReviewDirectoryGroupOverflow(groups, visibleLimit)

      expect(result.visibleGroups).toEqual(groups.slice(0, visibleCount))
      expect(result.remainingCount).toBe(remainingCount)
      expect(groups.map(({ name }) => name)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
    },
  )

  it('uses a bounded default without reordering or mutating canonical groups', () => {
    const groups = directoryGroups()

    const result = organizationReviewDirectoryGroupOverflow(groups)

    expect(result.visibleGroups.map(({ name }) => name)).toEqual(['Alpha', 'Bravo'])
    expect(result.remainingCount).toBe(2)
    expect(groups.map(({ name }) => name)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
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
