import type { PlatformReviewerDirectoryRow } from '@eve-space/platform-module-contract/reviewer-directory'
import { describe, expect, it } from 'vitest'
import {
  normalizeOrganizationReviewDirectoryFieldIds,
  normalizeOrganizationReviewDirectoryPreference,
  organizationReviewDirectoryDefaultFieldIds,
  organizationReviewDirectoryFields,
  organizationReviewDirectoryPreferenceVersion,
} from '../../app/utils/organization-review-directory-fields'

describe('organization reviewer directory fields', () => {
  it('publishes the stable catalogue and documented default layout', () => {
    expect(organizationReviewDirectoryFields.map(({ id }) => id)).toEqual([
      'member',
      'corporation',
      'managed_since',
      'audit_data',
      'groups',
      'access_status',
      'disclosed_characters',
      'affiliation_checked_at',
      'site_registered_at',
      'review_deadline',
      'access_valid_until',
      'blocked_since',
      'actions',
    ])
    expect(organizationReviewDirectoryDefaultFieldIds).toEqual([
      'member',
      'corporation',
      'managed_since',
      'audit_data',
      'groups',
      'access_status',
      'actions',
    ])
    expect(organizationReviewDirectoryFields[0]).toMatchObject({
      id: 'member',
      locked: 'leading',
      sort: 'member',
    })
    expect(organizationReviewDirectoryFields.at(-1)).toMatchObject({
      id: 'actions',
      locked: 'trailing',
      sort: null,
    })
  })

  it('repairs locked fields while preserving valid optional-field order', () => {
    expect(
      normalizeOrganizationReviewDirectoryFieldIds([
        'actions',
        'groups',
        'unknown',
        'groups',
        'member',
        'site_registered_at',
      ]),
    ).toEqual(['member', 'groups', 'site_registered_at', 'actions'])
    expect(normalizeOrganizationReviewDirectoryFieldIds([])).toEqual(['member', 'actions'])
  })

  it('accepts only the current preference version and array shape', () => {
    expect(
      normalizeOrganizationReviewDirectoryPreference({
        version: organizationReviewDirectoryPreferenceVersion,
        fieldIds: ['blocked_since', 'corporation'],
      }),
    ).toEqual(['member', 'blocked_since', 'corporation', 'actions'])
    expect(
      normalizeOrganizationReviewDirectoryPreference({ version: 0, fieldIds: ['groups'] }),
    ).toEqual(organizationReviewDirectoryDefaultFieldIds)
    expect(
      normalizeOrganizationReviewDirectoryPreference({
        version: organizationReviewDirectoryPreferenceVersion,
        fieldIds: 'groups',
      }),
    ).toEqual(organizationReviewDirectoryDefaultFieldIds)
    expect(normalizeOrganizationReviewDirectoryPreference(null)).toEqual(
      organizationReviewDirectoryDefaultFieldIds,
    )
  })

  it('presents the server-authorized portrait identity without recomputing it', () => {
    const member = {
      managedMemberLifecycleId: 'member-lifecycle-1',
      managedSince: '2026-01-01T00:00:00.000Z',
      siteRegisteredAt: '2025-12-01T00:00:00.000Z',
      account: {
        userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
        mainCharacter: { characterId: 90_000_001, name: 'Untrusted Choice' },
      },
      portraitCharacter: {
        characterId: 90_000_002,
        name: 'Authorized Portrait',
        source: 'managed-affiliation' as const,
      },
      managedAffiliation: {
        characterId: 90_000_002,
        name: 'Managed Pilot',
        corporationId: 98_000_001,
        allianceId: null,
        checkedAt: '2026-09-18T00:00:00.000Z',
      },
      disclosedCharacterCount: 2,
      groups: [],
      compliance: {
        state: 'compliant' as const,
        evidenceFreshness: 'fresh' as const,
        evidenceAt: '2026-09-18T00:00:00.000Z',
        reviewDeadline: null,
        accessValidUntil: '2026-09-19T00:00:00.000Z',
        evaluatedAt: '2026-09-18T00:00:00.000Z',
      },
      block: { blocked: false as const },
      auditData: {
        state: 'current' as const,
        expected: 7,
        covered: 7,
        asOf: '2026-09-18T00:00:00.000Z',
      },
    } satisfies PlatformReviewerDirectoryRow
    const memberField = organizationReviewDirectoryFields.find(({ id }) => id === 'member')!

    expect(memberField.present(member)).toMatchObject({
      kind: 'member',
      identity: { characterId: 90_000_002, name: 'Authorized Portrait' },
    })
  })
})
