import type {
  PlatformReviewerCharacterDirectoryRow,
  PlatformReviewerCharacterDirectorySortField,
} from '@eve-space/platform-module-contract/reviewer-directory'
import {
  organizationReviewDirectoryAccess,
  organizationReviewDirectoryAuditStateLabel,
} from './organization-review-directory-presentation'

export const organizationReviewDirectoryPreferenceVersion = 2

export const organizationReviewDirectoryFieldIds = [
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
] as const

export type OrganizationReviewDirectoryFieldId =
  (typeof organizationReviewDirectoryFieldIds)[number]

export type OrganizationReviewDirectoryCell =
  | {
      readonly kind: 'character'
      readonly identity: PlatformReviewerCharacterDirectoryRow['character']
      readonly detail: string
    }
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'date'; readonly timestamp: string | null }
  | {
      readonly kind: 'audit'
      readonly state: PlatformReviewerCharacterDirectoryRow['auditData']['state']
      readonly label: string
      readonly covered: number
      readonly expected: number
      readonly asOf: string | null
    }
  | { readonly kind: 'groups'; readonly groups: PlatformReviewerCharacterDirectoryRow['groups'] }
  | {
      readonly kind: 'access'
      readonly state: string
      readonly label: string
      readonly evidenceFreshness: PlatformReviewerCharacterDirectoryRow['compliance']['evidenceFreshness']
    }
  | { readonly kind: 'actions' }

export interface OrganizationReviewDirectoryFieldDefinition {
  readonly id: OrganizationReviewDirectoryFieldId
  readonly label: string
  readonly defaultVisible: boolean
  readonly locked: 'leading' | 'trailing' | null
  readonly sort: PlatformReviewerCharacterDirectorySortField | null
  present(member: PlatformReviewerCharacterDirectoryRow): OrganizationReviewDirectoryCell
}

export const organizationReviewDirectoryFields = [
  field('character', 'Character', true, 'leading', 'character', (member) => ({
    detail:
      member.character.affiliation.membership === 'approved-external'
        ? `Approved external · Account ${member.account.mainCharacter?.name ?? 'unknown main'}`
        : `Account ${member.account.mainCharacter?.name ?? 'unknown main'}`,
    identity: member.character,
    kind: 'character',
  })),
  field('corporation', 'Corporation', true, null, 'corporation', (member) => ({
    kind: 'text',
    value: `Corporation ${member.character.affiliation.corporationId} (${member.character.affiliation.membership}, ${member.character.affiliation.freshness})`,
  })),
  field('managed_since', 'Account managed since', true, null, 'managed_since', (member) => ({
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
  field('groups', 'Account groups', true, null, null, (member) => ({
    groups: member.groups,
    kind: 'groups',
  })),
  field('access_status', 'Account access status', true, null, 'access_status', (member) => {
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
    'Account disclosed characters',
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
    (member) => ({ kind: 'date', timestamp: member.character.affiliation.checkedAt }),
  ),
  field(
    'site_registered_at',
    'Account site registered',
    false,
    null,
    'site_registered_at',
    (member) => ({
      kind: 'date',
      timestamp: member.siteRegisteredAt,
    }),
  ),
  field('review_deadline', 'Account review deadline', false, null, 'review_deadline', (member) => ({
    kind: 'date',
    timestamp: member.compliance.reviewDeadline,
  })),
  field(
    'access_valid_until',
    'Account access valid until',
    false,
    null,
    'access_valid_until',
    (member) => ({ kind: 'date', timestamp: member.compliance.accessValidUntil }),
  ),
  field('blocked_since', 'Account blocked since', false, null, 'blocked_since', (member) => ({
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
  if (
    !isRecord(value) ||
    (value.version !== 1 && value.version !== organizationReviewDirectoryPreferenceVersion)
  ) {
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
    if (value === 'member') {
      continue
    }
    if (
      !isOrganizationReviewDirectoryFieldId(value) ||
      value === 'character' ||
      value === 'actions'
    ) {
      continue
    }
    if (seen.has(value)) {
      continue
    }
    seen.add(value)
    optionalFields.push(value)
  }
  return ['character', ...optionalFields, 'actions']
}

function field(
  id: OrganizationReviewDirectoryFieldId,
  label: string,
  defaultVisible: boolean,
  locked: OrganizationReviewDirectoryFieldDefinition['locked'],
  sort: PlatformReviewerCharacterDirectorySortField | null,
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
