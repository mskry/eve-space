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
    detail:
      member.portraitCharacter.source === 'main-character'
        ? `Managed via ${member.managedAffiliation.name}`
        : 'Managed affiliation',
    identity: member.portraitCharacter,
    kind: 'member',
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
    asOf: member.auditData.asOf,
    covered: member.auditData.covered,
    expected: member.auditData.expected,
    kind: 'audit',
    label: organizationReviewDirectoryAuditStateLabel(member.auditData.state),
    state: member.auditData.state,
  })),
  field('groups', 'Groups', true, null, null, (member) => ({
    groups: member.groups,
    kind: 'groups',
  })),
  field('access_status', 'Access status', true, null, 'access_status', (member) => {
    const access = organizationReviewDirectoryAccess(member.compliance.state, member.block)
    return {
      evidenceFreshness: member.compliance.evidenceFreshness,
      kind: 'access',
      label: access.label,
      state: access.state,
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
  if (!isRecord(value) || value.version !== organizationReviewDirectoryPreferenceVersion) {
    return organizationReviewDirectoryDefaultFieldIds
  }
  if (!Array.isArray(value.fieldIds)) {
    return organizationReviewDirectoryDefaultFieldIds
  }
  return normalizeOrganizationReviewDirectoryFieldIds(value.fieldIds)
}

export function normalizeOrganizationReviewDirectoryFieldIds(
  values: readonly unknown[],
): readonly OrganizationReviewDirectoryFieldId[] {
  const optionalFields: OrganizationReviewDirectoryFieldId[] = []
  const seen = new Set<OrganizationReviewDirectoryFieldId>()
  for (const value of values) {
    if (!isOrganizationReviewDirectoryFieldId(value) || value === 'member' || value === 'actions') {
      continue
    }
    if (seen.has(value)) {
      continue
    }
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
  return { defaultVisible, id, label, locked, present, sort }
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
