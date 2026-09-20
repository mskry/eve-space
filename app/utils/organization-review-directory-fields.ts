import type {
  PlatformReviewerDirectoryRow,
  PlatformReviewerDirectorySortField,
} from '@eve-space/platform-module-contract/reviewer-directory'
import {
  organizationReviewDirectoryAccess,
  organizationReviewDirectoryAuditStateLabel,
} from './organization-review-directory-presentation'

export const organizationReviewDirectoryPreferenceVersion = 1

export const organizationReviewDirectoryFieldIds = [
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
] as const

export type OrganizationReviewDirectoryFieldId =
  (typeof organizationReviewDirectoryFieldIds)[number]

export type OrganizationReviewDirectoryCell =
  | {
      readonly kind: 'member'
      readonly identity: PlatformReviewerDirectoryRow['portraitCharacter']
      readonly detail: string
    }
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'date'; readonly timestamp: string | null }
  | {
      readonly kind: 'audit'
      readonly state: PlatformReviewerDirectoryRow['auditData']['state']
      readonly label: string
      readonly covered: number
      readonly expected: number
      readonly asOf: string | null
    }
  | { readonly kind: 'groups'; readonly groups: PlatformReviewerDirectoryRow['groups'] }
  | {
      readonly kind: 'access'
      readonly state: string
      readonly label: string
      readonly evidenceFreshness: PlatformReviewerDirectoryRow['compliance']['evidenceFreshness']
    }
  | { readonly kind: 'actions' }

export interface OrganizationReviewDirectoryFieldDefinition {
  readonly id: OrganizationReviewDirectoryFieldId
  readonly label: string
  readonly defaultVisible: boolean
  readonly locked: 'leading' | 'trailing' | null
  readonly sort: PlatformReviewerDirectorySortField | null
  present(member: PlatformReviewerDirectoryRow): OrganizationReviewDirectoryCell
}

export const organizationReviewDirectoryFields = [
  field('member', 'Member', true, 'leading', 'member', (member) => ({
    kind: 'member',
    identity: member.portraitCharacter,
    detail:
      member.portraitCharacter.source === 'main-character'
        ? `Managed via ${member.managedAffiliation.name}`
        : 'Managed affiliation',
  })),
  field('corporation', 'Corporation', true, null, 'corporation', (member) => ({
    kind: 'text',
    value: `Corporation ${member.managedAffiliation.corporationId}`,
  })),
  field('managed_since', 'Managed since', true, null, 'managed_since', (member) => ({
    kind: 'date',
    timestamp: member.managedSince,
  })),
  field('audit_data', 'Audit data', true, null, 'audit_data', (member) => ({
    kind: 'audit',
    state: member.auditData.state,
    label: organizationReviewDirectoryAuditStateLabel(member.auditData.state),
    covered: member.auditData.covered,
    expected: member.auditData.expected,
    asOf: member.auditData.asOf,
  })),
  field('groups', 'Groups', true, null, null, (member) => ({
    kind: 'groups',
    groups: member.groups,
  })),
  field('access_status', 'Access status', true, null, 'access_status', (member) => {
    const access = organizationReviewDirectoryAccess(member.compliance.state, member.block)
    return {
      kind: 'access',
      state: access.state,
      label: access.label,
      evidenceFreshness: member.compliance.evidenceFreshness,
    }
  }),
  field(
    'disclosed_characters',
    'Disclosed characters',
    false,
    null,
    'disclosed_characters',
    (member) => ({ kind: 'text', value: String(member.disclosedCharacterCount) }),
  ),
  field(
    'affiliation_checked_at',
    'Affiliation checked',
    false,
    null,
    'affiliation_checked_at',
    (member) => ({ kind: 'date', timestamp: member.managedAffiliation.checkedAt }),
  ),
  field('site_registered_at', 'Site registered', false, null, 'site_registered_at', (member) => ({
    kind: 'date',
    timestamp: member.siteRegisteredAt,
  })),
  field('review_deadline', 'Review deadline', false, null, 'review_deadline', (member) => ({
    kind: 'date',
    timestamp: member.compliance.reviewDeadline,
  })),
  field(
    'access_valid_until',
    'Access valid until',
    false,
    null,
    'access_valid_until',
    (member) => ({ kind: 'date', timestamp: member.compliance.accessValidUntil }),
  ),
  field('blocked_since', 'Blocked since', false, null, 'blocked_since', (member) => ({
    kind: 'date',
    timestamp: member.block.blocked ? member.block.blockedAt : null,
  })),
  field('actions', 'Actions', true, 'trailing', null, () => ({ kind: 'actions' })),
] as const satisfies readonly OrganizationReviewDirectoryFieldDefinition[]

export const organizationReviewDirectoryDefaultFieldIds = organizationReviewDirectoryFields
  .filter(({ defaultVisible }) => defaultVisible)
  .map(({ id }) => id)

export interface OrganizationReviewDirectoryPreference {
  readonly version: number
  readonly fieldIds: readonly OrganizationReviewDirectoryFieldId[]
}

export function normalizeOrganizationReviewDirectoryPreference(
  value: unknown,
): readonly OrganizationReviewDirectoryFieldId[] {
  if (!isRecord(value) || value.version !== organizationReviewDirectoryPreferenceVersion)
    return organizationReviewDirectoryDefaultFieldIds
  if (!Array.isArray(value.fieldIds)) return organizationReviewDirectoryDefaultFieldIds
  return normalizeOrganizationReviewDirectoryFieldIds(value.fieldIds)
}

export function normalizeOrganizationReviewDirectoryFieldIds(
  values: readonly unknown[],
): readonly OrganizationReviewDirectoryFieldId[] {
  const optionalFields: OrganizationReviewDirectoryFieldId[] = []
  const seen = new Set<OrganizationReviewDirectoryFieldId>()
  for (const value of values) {
    if (!isOrganizationReviewDirectoryFieldId(value) || value === 'member' || value === 'actions')
      continue
    if (seen.has(value)) continue
    seen.add(value)
    optionalFields.push(value)
  }
  return ['member', ...optionalFields, 'actions']
}

function field(
  id: OrganizationReviewDirectoryFieldId,
  label: string,
  defaultVisible: boolean,
  locked: OrganizationReviewDirectoryFieldDefinition['locked'],
  sort: PlatformReviewerDirectorySortField | null,
  present: OrganizationReviewDirectoryFieldDefinition['present'],
): OrganizationReviewDirectoryFieldDefinition {
  return { id, label, defaultVisible, locked, sort, present }
}

function isOrganizationReviewDirectoryFieldId(
  value: unknown,
): value is OrganizationReviewDirectoryFieldId {
  return (
    typeof value === 'string' &&
    (organizationReviewDirectoryFieldIds as readonly string[]).includes(value)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
