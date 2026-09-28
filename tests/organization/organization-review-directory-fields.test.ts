import type { PlatformReviewerCharacterDirectoryRow } from '@eve-space/platform-module-contract/reviewer-directory'
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
    expect(organizationReviewDirectoryFields.map(({ id }) => id)).toStrictEqual([
      'character',
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
    expect(organizationReviewDirectoryDefaultFieldIds).toStrictEqual([
      'character',
      'corporation',
      'managed_since',
      'audit_data',
      'groups',
      'access_status',
      'actions',
    ])
    expect(organizationReviewDirectoryFields[0]).toMatchObject({
      id: 'character',
      locked: 'leading',
      sort: 'character',
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
    ).toStrictEqual(['character', 'groups', 'site_registered_at', 'actions'])
    expect(normalizeOrganizationReviewDirectoryFieldIds([])).toStrictEqual(['character', 'actions'])
  })

  it('accepts only the current preference version and array shape', () => {
    expect(
      normalizeOrganizationReviewDirectoryPreference({
        fieldIds: ['blocked_since', 'corporation'],
        version: organizationReviewDirectoryPreferenceVersion,
      }),
    ).toStrictEqual(['character', 'blocked_since', 'corporation', 'actions'])
    expect(
      normalizeOrganizationReviewDirectoryPreference({
        fieldIds: ['member', 'groups', 'groups'],
        version: 1,
      }),
    ).toStrictEqual(['character', 'groups', 'actions'])
    expect(
      normalizeOrganizationReviewDirectoryPreference({ fieldIds: ['groups'], version: 0 }),
    ).toStrictEqual(organizationReviewDirectoryDefaultFieldIds)
    expect(
      normalizeOrganizationReviewDirectoryPreference({
        fieldIds: 'groups',
        version: organizationReviewDirectoryPreferenceVersion,
      }),
    ).toStrictEqual(organizationReviewDirectoryDefaultFieldIds)
    expect(normalizeOrganizationReviewDirectoryPreference(null)).toStrictEqual(
      organizationReviewDirectoryDefaultFieldIds,
    )
  })

  it('presents the exact character rather than substituting the account main', () => {
    const member = {
      account: {
        mainCharacter: { characterId: 90_000_001, name: 'Untrusted Choice' },
        userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
      },
      auditData: {
        asOf: '2026-09-18T00:00:00.000Z',
        covered: 7,
        expected: 7,
        state: 'current' as const,
      },
      block: { blocked: false as const },
      compliance: {
        accessValidUntil: '2026-09-19T00:00:00.000Z',
        evaluatedAt: '2026-09-18T00:00:00.000Z',
        evidenceAt: '2026-09-18T00:00:00.000Z',
        evidenceFreshness: 'fresh' as const,
        reviewDeadline: null,
        state: 'compliant' as const,
      },
      disclosedCharacterCount: 2,
      groups: [],
      character: {
        characterId: 90_000_002,
        subjectLifecycleId: 'character-lifecycle-2',
        authorizationGeneration: 4,
        name: 'Authorized Alt',
        isMain: false,
        affiliation: {
          allianceId: null,
          checkedAt: '2026-09-18T00:00:00.000Z',
          corporationId: 98_000_001,
          membership: 'approved-external' as const,
          freshness: 'fresh' as const,
        },
      },
      managedMemberLifecycleId: 'member-lifecycle-1',
      managedSince: '2026-01-01T00:00:00.000Z',
      siteRegisteredAt: '2025-12-01T00:00:00.000Z',
    } satisfies PlatformReviewerCharacterDirectoryRow
    const memberField = organizationReviewDirectoryFields.find(({ id }) => id === 'character')!

    expect(memberField.present(member)).toMatchObject({
      identity: { characterId: 90_000_002, name: 'Authorized Alt' },
      kind: 'character',
    })
  })
})
