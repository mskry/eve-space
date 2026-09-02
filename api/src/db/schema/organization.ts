import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { characters, users } from './identity.js'
import { organizationEpochs } from './organization-epochs.js'
import { auditTimestamps } from './shared.js'

export const organizationManagedCorporations = pgTable(
  'organization_managed_corporations',
  {
    deploymentId: smallint('deployment_id').default(1).notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    corporationId: bigint('corporation_id', { mode: 'number' }).notNull(),
    isCurrent: boolean('is_current').default(true).notNull(),
    firstObservedAt: timestamp('first_observed_at', { withTimezone: true, mode: 'date' }).notNull(),
    lastObservedAt: timestamp('last_observed_at', { withTimezone: true, mode: 'date' }).notNull(),
    removedAt: timestamp('removed_at', { withTimezone: true, mode: 'date' }),
    ...auditTimestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.deploymentId, table.organizationVersion, table.corporationId] }),
    foreignKey({
      columns: [table.deploymentId, table.organizationVersion],
      foreignColumns: [organizationEpochs.deploymentId, organizationEpochs.organizationVersion],
      name: 'organization_managed_corporations_epoch_fkey',
    }).onDelete('restrict'),
    check('organization_managed_corporations_id_check', sql`corporation_id > 0`),
    check(
      'organization_managed_corporations_observed_at_check',
      sql`last_observed_at >= first_observed_at`,
    ),
    check(
      'organization_managed_corporations_current_check',
      sql`(is_current and removed_at is null) or (not is_current and removed_at is not null)`,
    ),
    check(
      'organization_managed_corporations_removed_at_check',
      sql`removed_at is null or removed_at >= first_observed_at`,
    ),
    index('organization_managed_corporations_current_idx')
      .on(table.deploymentId, table.organizationVersion, table.corporationId)
      .where(sql`is_current`),
  ],
)

export const organizationCorporationSources = pgTable(
  'organization_corporation_sources',
  {
    sourceId: uuid('source_id').defaultRandom().primaryKey().notNull(),
    deploymentId: smallint('deployment_id').default(1).notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    corporationId: bigint('corporation_id', { mode: 'number' }).notNull(),
    characterId: bigint('character_id', { mode: 'number' }),
    evidenceCharacterId: bigint('evidence_character_id', { mode: 'number' }).notNull(),
    registeredByUserId: uuid('registered_by_user_id').notNull(),
    registeredAt: timestamp('registered_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revokedByUserId: uuid('revoked_by_user_id'),
    revocationReason: text('revocation_reason'),
    ...auditTimestamps(),
  },
  (table) => [
    unique('organization_corporation_sources_source_version_key').on(
      table.sourceId,
      table.deploymentId,
      table.organizationVersion,
      table.corporationId,
    ),
    foreignKey({
      columns: [table.deploymentId, table.organizationVersion, table.corporationId],
      foreignColumns: [
        organizationManagedCorporations.deploymentId,
        organizationManagedCorporations.organizationVersion,
        organizationManagedCorporations.corporationId,
      ],
      name: 'organization_corporation_sources_managed_corporation_fkey',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.characterId],
      foreignColumns: [characters.characterId],
      name: 'organization_corporation_sources_character_id_fkey',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.registeredByUserId],
      foreignColumns: [users.id],
      name: 'organization_corporation_sources_registered_by_user_id_fkey',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.revokedByUserId],
      foreignColumns: [users.id],
      name: 'organization_corporation_sources_revoked_by_user_id_fkey',
    }).onDelete('restrict'),
    check(
      'organization_corporation_sources_revocation_check',
      sql`(revoked_at is null and revoked_by_user_id is null and revocation_reason is null)
        or (
          revoked_at is not null
          and revoked_by_user_id is not null
          and length(trim(revocation_reason)) > 0
          and revoked_at >= registered_at
        )`,
    ),
    check(
      'organization_corporation_sources_evidence_character_id_check',
      sql`evidence_character_id > 0`,
    ),
    uniqueIndex('organization_corporation_sources_active_key')
      .on(table.deploymentId, table.organizationVersion, table.corporationId)
      .where(sql`revoked_at is null`),
    index('organization_corporation_sources_character_idx')
      .on(table.characterId)
      .where(sql`revoked_at is null`),
  ],
)

export const organizationCorporationRosterObservations = pgTable(
  'organization_corporation_roster_observations',
  {
    deploymentId: smallint('deployment_id').default(1).notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    corporationId: bigint('corporation_id', { mode: 'number' }).notNull(),
    characterId: bigint('character_id', { mode: 'number' }).notNull(),
    sourceId: uuid('source_id').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true, mode: 'date' }).notNull(),
    ...auditTimestamps(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.deploymentId,
        table.organizationVersion,
        table.corporationId,
        table.characterId,
      ],
    }),
    foreignKey({
      columns: [table.sourceId, table.deploymentId, table.organizationVersion, table.corporationId],
      foreignColumns: [
        organizationCorporationSources.sourceId,
        organizationCorporationSources.deploymentId,
        organizationCorporationSources.organizationVersion,
        organizationCorporationSources.corporationId,
      ],
      name: 'organization_corporation_roster_source_fkey',
    }).onDelete('restrict'),
    check('organization_corporation_roster_character_id_check', sql`character_id > 0`),
    index('organization_corporation_roster_source_idx').on(table.sourceId),
  ],
)

export type OrganizationComplianceState = 'pending' | 'compliant' | 'review_required' | 'suspended'

export type OrganizationEvidenceFreshness = 'fresh' | 'stale' | 'unavailable'

export const organizationAccountCompliance = pgTable(
  'organization_account_compliance',
  {
    deploymentId: smallint('deployment_id').default(1).notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    userId: uuid('user_id').notNull(),
    state: text().$type<OrganizationComplianceState>().default('pending').notNull(),
    evidenceFreshness: text('evidence_freshness')
      .$type<OrganizationEvidenceFreshness>()
      .default('unavailable')
      .notNull(),
    evidenceAt: timestamp('evidence_at', { withTimezone: true, mode: 'date' }),
    reviewDeadline: timestamp('review_deadline', { withTimezone: true, mode: 'date' }),
    accessValidUntil: timestamp('access_valid_until', { withTimezone: true, mode: 'date' }),
    establishedCompliantAt: timestamp('established_compliant_at', {
      withTimezone: true,
      mode: 'date',
    }),
    authoritative: boolean().default(true).notNull(),
    invalidatedAt: timestamp('invalidated_at', { withTimezone: true, mode: 'date' }),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    ...auditTimestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.deploymentId, table.organizationVersion, table.userId] }),
    foreignKey({
      columns: [table.deploymentId, table.organizationVersion],
      foreignColumns: [organizationEpochs.deploymentId, organizationEpochs.organizationVersion],
      name: 'organization_account_compliance_epoch_fkey',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'organization_account_compliance_user_id_fkey',
    }).onDelete('cascade'),
    check(
      'organization_account_compliance_state_check',
      sql`state in ('pending', 'compliant', 'review_required', 'suspended')`,
    ),
    check(
      'organization_account_compliance_freshness_check',
      sql`evidence_freshness in ('fresh', 'stale', 'unavailable')`,
    ),
    check(
      'organization_account_compliance_evidence_check',
      sql`(evidence_freshness = 'unavailable' and evidence_at is null)
        or (evidence_freshness <> 'unavailable' and evidence_at is not null)`,
    ),
    check(
      'organization_account_compliance_deadline_check',
      sql`review_deadline is null or state in ('review_required', 'suspended')`,
    ),
    check(
      'organization_account_compliance_access_validity_check',
      sql`(state = 'compliant' and access_valid_until is not null)
        or (
          state = 'review_required'
          and (
            (established_compliant_at is null and access_valid_until is null)
            or (
              established_compliant_at is not null
              and access_valid_until is not null
              and access_valid_until <= review_deadline
            )
          )
        )
        or (state in ('pending', 'suspended') and access_valid_until is null)`,
    ),
    check(
      'organization_account_compliance_established_check',
      sql`established_compliant_at is null or established_compliant_at <= evaluated_at`,
    ),
    check(
      'organization_account_compliance_authoritative_check',
      sql`(authoritative and invalidated_at is null)
        or (not authoritative and invalidated_at is not null)`,
    ),
    index('organization_account_compliance_repair_idx').on(
      table.deploymentId,
      table.organizationVersion,
      table.evaluatedAt,
      table.userId,
    ),
    index('organization_account_compliance_authoritative_idx')
      .on(table.deploymentId, table.organizationVersion, table.userId)
      .where(sql`authoritative`),
    index('organization_account_compliance_access_expiry_idx')
      .on(table.accessValidUntil, table.userId)
      .where(sql`authoritative and access_valid_until is not null`),
  ],
)

export const organizationComplianceIssues = pgTable(
  'organization_compliance_issues',
  {
    issueId: uuid('issue_id').defaultRandom().primaryKey().notNull(),
    deploymentId: smallint('deployment_id').default(1).notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    userId: uuid('user_id').notNull(),
    issueKey: text('issue_key').notNull(),
    issueCode: text('issue_code').notNull(),
    characterId: bigint('character_id', { mode: 'number' }),
    requiredScope: text('required_scope'),
    firstObservedAt: timestamp('first_observed_at', { withTimezone: true, mode: 'date' }).notNull(),
    lastObservedAt: timestamp('last_observed_at', { withTimezone: true, mode: 'date' }).notNull(),
    ...auditTimestamps(),
  },
  (table) => [
    foreignKey({
      columns: [table.deploymentId, table.organizationVersion, table.userId],
      foreignColumns: [
        organizationAccountCompliance.deploymentId,
        organizationAccountCompliance.organizationVersion,
        organizationAccountCompliance.userId,
      ],
      name: 'organization_compliance_issues_projection_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.userId, table.characterId],
      foreignColumns: [characters.userId, characters.characterId],
      name: 'organization_compliance_issues_character_owner_fkey',
    }).onDelete('cascade'),
    check('organization_compliance_issues_key_check', sql`length(trim(issue_key)) > 0`),
    check('organization_compliance_issues_code_check', sql`length(trim(issue_code)) > 0`),
    check(
      'organization_compliance_issues_required_scope_check',
      sql`required_scope is null or length(trim(required_scope)) > 0`,
    ),
    check(
      'organization_compliance_issues_observed_at_check',
      sql`last_observed_at >= first_observed_at`,
    ),
    unique('organization_compliance_issues_projection_key').on(
      table.deploymentId,
      table.organizationVersion,
      table.userId,
      table.issueKey,
    ),
    index('organization_compliance_issues_character_idx')
      .on(table.characterId)
      .where(sql`character_id is not null`),
  ],
)

export const organizationCharacterExceptions = pgTable(
  'organization_character_exceptions',
  {
    exceptionId: uuid('exception_id').defaultRandom().primaryKey().notNull(),
    deploymentId: smallint('deployment_id').default(1).notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    userId: uuid('user_id').notNull(),
    characterId: bigint('character_id', { mode: 'number' }).notNull(),
    approverUserId: uuid('approver_user_id').notNull(),
    reason: text().notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    expiredAt: timestamp('expired_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revokedByUserId: uuid('revoked_by_user_id'),
    revocationReason: text('revocation_reason'),
    ...auditTimestamps(),
  },
  (table) => [
    unique('organization_character_exceptions_version_key').on(
      table.exceptionId,
      table.deploymentId,
      table.organizationVersion,
    ),
    foreignKey({
      columns: [table.deploymentId, table.organizationVersion],
      foreignColumns: [organizationEpochs.deploymentId, organizationEpochs.organizationVersion],
      name: 'organization_character_exceptions_epoch_fkey',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.userId, table.characterId],
      foreignColumns: [characters.userId, characters.characterId],
      name: 'organization_character_exceptions_character_owner_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.approverUserId],
      foreignColumns: [users.id],
      name: 'organization_character_exceptions_approver_user_id_fkey',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.revokedByUserId],
      foreignColumns: [users.id],
      name: 'organization_character_exceptions_revoked_by_user_id_fkey',
    }).onDelete('restrict'),
    check('organization_character_exceptions_reason_check', sql`length(trim(reason)) > 0`),
    check(
      'organization_character_exceptions_expiry_check',
      sql`expires_at is null or expires_at > approved_at`,
    ),
    check(
      'organization_character_exceptions_revocation_check',
      sql`(revoked_at is null and revoked_by_user_id is null and revocation_reason is null)
        or (
          revoked_at is not null
          and revoked_by_user_id is not null
          and length(trim(revocation_reason)) > 0
          and revoked_at >= approved_at
        )`,
    ),
    check(
      'organization_character_exceptions_expired_at_check',
      sql`expired_at is null or (expires_at is not null and expired_at >= expires_at)`,
    ),
    index('organization_character_exceptions_subject_idx')
      .on(
        table.deploymentId,
        table.organizationVersion,
        table.userId,
        table.characterId,
        table.expiresAt,
      )
      .where(sql`revoked_at is null`),
    index('organization_character_exceptions_expiry_idx')
      .on(table.expiresAt, table.exceptionId)
      .where(sql`revoked_at is null and expired_at is null and expires_at is not null`),
  ],
)

export type ElevatedOrganizationRole = 'hr_auditor' | 'director' | 'organization_owner'

export const organizationRoleGrants = pgTable(
  'organization_role_grants',
  {
    grantId: uuid('grant_id').defaultRandom().primaryKey().notNull(),
    deploymentId: smallint('deployment_id').default(1).notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    userId: uuid('user_id').notNull(),
    role: text().$type<ElevatedOrganizationRole>().notNull(),
    grantedByUserId: uuid('granted_by_user_id').notNull(),
    reason: text().notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revokedByUserId: uuid('revoked_by_user_id'),
    revocationReason: text('revocation_reason'),
    ...auditTimestamps(),
  },
  (table) => [
    unique('organization_role_grants_version_identity_key').on(
      table.grantId,
      table.deploymentId,
      table.organizationVersion,
      table.userId,
      table.role,
    ),
    foreignKey({
      columns: [table.deploymentId, table.organizationVersion],
      foreignColumns: [organizationEpochs.deploymentId, organizationEpochs.organizationVersion],
      name: 'organization_role_grants_epoch_fkey',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'organization_role_grants_user_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.grantedByUserId],
      foreignColumns: [users.id],
      name: 'organization_role_grants_granted_by_user_id_fkey',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.revokedByUserId],
      foreignColumns: [users.id],
      name: 'organization_role_grants_revoked_by_user_id_fkey',
    }).onDelete('restrict'),
    check(
      'organization_role_grants_role_check',
      sql`role in ('hr_auditor', 'director', 'organization_owner')`,
    ),
    check('organization_role_grants_reason_check', sql`length(trim(reason)) > 0`),
    check(
      'organization_role_grants_revocation_check',
      sql`(revoked_at is null and revoked_by_user_id is null and revocation_reason is null)
        or (
          revoked_at is not null
          and length(trim(revocation_reason)) > 0
          and revoked_at >= granted_at
        )`,
    ),
    uniqueIndex('organization_role_grants_active_key')
      .on(table.deploymentId, table.organizationVersion, table.userId, table.role)
      .where(sql`revoked_at is null`),
    index('organization_role_grants_active_role_idx')
      .on(table.deploymentId, table.organizationVersion, table.role, table.userId)
      .where(sql`revoked_at is null`),
  ],
)

export const organizationMemberBlocks = pgTable(
  'organization_member_blocks',
  {
    blockId: uuid('block_id').defaultRandom().primaryKey().notNull(),
    deploymentId: smallint('deployment_id').default(1).notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    userId: uuid('user_id').notNull(),
    blockedByUserId: uuid('blocked_by_user_id').notNull(),
    reason: text().notNull(),
    blockedAt: timestamp('blocked_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    unblockedAt: timestamp('unblocked_at', { withTimezone: true, mode: 'date' }),
    unblockedByUserId: uuid('unblocked_by_user_id'),
    unblockReason: text('unblock_reason'),
    ...auditTimestamps(),
  },
  (table) => [
    unique('organization_member_blocks_version_key').on(
      table.blockId,
      table.deploymentId,
      table.organizationVersion,
      table.userId,
    ),
    foreignKey({
      columns: [table.deploymentId, table.organizationVersion],
      foreignColumns: [organizationEpochs.deploymentId, organizationEpochs.organizationVersion],
      name: 'organization_member_blocks_epoch_fkey',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'organization_member_blocks_user_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.blockedByUserId],
      foreignColumns: [users.id],
      name: 'organization_member_blocks_blocked_by_user_id_fkey',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.unblockedByUserId],
      foreignColumns: [users.id],
      name: 'organization_member_blocks_unblocked_by_user_id_fkey',
    }).onDelete('restrict'),
    check('organization_member_blocks_reason_check', sql`length(trim(reason)) between 1 and 2000`),
    check(
      'organization_member_blocks_unblock_check',
      sql`(
          unblocked_at is null
          and unblocked_by_user_id is null
          and unblock_reason is null
        ) or (
          unblocked_at is not null
          and unblocked_at >= blocked_at
          and unblocked_by_user_id is not null
          and length(trim(unblock_reason)) between 1 and 2000
        )`,
    ),
    uniqueIndex('organization_member_blocks_active_key')
      .on(table.deploymentId, table.organizationVersion, table.userId)
      .where(sql`unblocked_at is null`),
    index('organization_member_blocks_active_subject_idx')
      .on(table.userId, table.deploymentId, table.organizationVersion)
      .where(sql`unblocked_at is null`),
  ],
)

export type OrganizationAuthorityEvidenceStatus = 'fresh' | 'review_required' | 'invalid'

export const organizationAuthorityEvidence = pgTable(
  'organization_authority_evidence',
  {
    evidenceId: uuid('evidence_id').defaultRandom().primaryKey().notNull(),
    grantId: uuid('grant_id').notNull(),
    deploymentId: smallint('deployment_id').default(1).notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    userId: uuid('user_id').notNull(),
    role: text().$type<'organization_owner'>().default('organization_owner').notNull(),
    characterId: bigint('character_id', { mode: 'number' }).notNull(),
    authorityCorporationId: bigint('authority_corporation_id', { mode: 'number' }).notNull(),
    observedCorporationId: bigint('observed_corporation_id', { mode: 'number' }).notNull(),
    observedAllianceId: bigint('observed_alliance_id', { mode: 'number' }),
    requiredScope: text('required_scope').notNull(),
    directorRolePresent: boolean('director_role_present').notNull(),
    status: text().$type<OrganizationAuthorityEvidenceStatus>().notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true, mode: 'date' }).notNull(),
    reviewDeadline: timestamp('review_deadline', { withTimezone: true, mode: 'date' }),
    failureClass: text('failure_class'),
    ...auditTimestamps(),
  },
  (table) => [
    unique('organization_authority_evidence_grant_key').on(table.grantId),
    foreignKey({
      columns: [
        table.grantId,
        table.deploymentId,
        table.organizationVersion,
        table.userId,
        table.role,
      ],
      foreignColumns: [
        organizationRoleGrants.grantId,
        organizationRoleGrants.deploymentId,
        organizationRoleGrants.organizationVersion,
        organizationRoleGrants.userId,
        organizationRoleGrants.role,
      ],
      name: 'organization_authority_evidence_grant_fkey',
    }).onDelete('restrict'),
    check('organization_authority_evidence_role_check', sql`role = 'organization_owner'`),
    check(
      'organization_authority_evidence_corporation_check',
      sql`authority_corporation_id > 0
        and observed_corporation_id = authority_corporation_id`,
    ),
    check('organization_authority_evidence_scope_check', sql`length(trim(required_scope)) > 0`),
    check(
      'organization_authority_evidence_status_check',
      sql`status in ('fresh', 'review_required', 'invalid')`,
    ),
    check(
      'organization_authority_evidence_verified_at_check',
      sql`(
          status = 'fresh'
          and verified_at is not null
          and director_role_present
          and failure_class is null
        )
        or (status <> 'fresh' and failure_class is not null)`,
    ),
    check(
      'organization_authority_evidence_review_check',
      sql`review_deadline is null or status = 'review_required'`,
    ),
    check(
      'organization_authority_evidence_checked_at_check',
      sql`verified_at is null or last_checked_at >= verified_at`,
    ),
    index('organization_authority_evidence_refresh_idx').on(
      table.status,
      table.lastCheckedAt,
      table.grantId,
    ),
  ],
)

export const organizationAuditEventTypes = [
  'organization.changed',
  'registration-policy.changed',
  'role.granted',
  'role.revoked',
  'exception.approved',
  'exception.expired',
  'exception.revoked',
  'compliance.transitioned',
  'entitlement.granted',
  'entitlement.revoked',
  'corporation-source.registered',
  'corporation-source.replaced',
  'corporation-source.revoked',
  'group.assigned',
  'group.revoked',
  'member.blocked',
  'member.unblocked',
] as const

export const organizationAuditActorTypes = ['user', 'deployment_admin', 'system'] as const
export const organizationAuditSubjectTypes = [
  'deployment',
  'user',
  'character',
  'role_grant',
  'exception',
  'compliance',
  'corporation_source',
  'managed_corporation',
  'group',
  'external_service',
] as const
export const organizationAuditOutcomes = [
  'granted',
  'revoked',
  'transitioned',
  'denied',
  'unchanged',
] as const

export type OrganizationAuditEventType = (typeof organizationAuditEventTypes)[number]
export type OrganizationAuditActorType = (typeof organizationAuditActorTypes)[number]
export type OrganizationAuditSubjectType = (typeof organizationAuditSubjectTypes)[number]
export type OrganizationAuditOutcome = (typeof organizationAuditOutcomes)[number]

export const organizationAuditEvents = pgTable(
  'organization_audit_events',
  {
    auditId: uuid('audit_id').defaultRandom().primaryKey().notNull(),
    auditSequence: bigint('audit_sequence', { mode: 'bigint' })
      .generatedAlwaysAsIdentity()
      .notNull(),
    deploymentId: smallint('deployment_id').default(1).notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    policyVersion: bigint('policy_version', { mode: 'number' }).notNull(),
    eventType: text('event_type').$type<OrganizationAuditEventType>().notNull(),
    actorType: text('actor_type').$type<OrganizationAuditActorType>().notNull(),
    actorId: uuid('actor_id'),
    subjectType: text('subject_type').$type<OrganizationAuditSubjectType>().notNull(),
    subjectId: text('subject_id').notNull(),
    reason: text().notNull(),
    outcome: text().$type<OrganizationAuditOutcome>().notNull(),
    groupId: uuid('group_id'),
    assignmentId: uuid('assignment_id'),
    targetUserId: uuid('target_user_id'),
    assignmentSource: text('assignment_source').$type<'manual' | 'compliance'>(),
    complianceSource: text('compliance_source'),
    entitlementExpiresAt: timestamp('entitlement_expires_at', {
      withTimezone: true,
      mode: 'date',
    }),
    causationAuditId: uuid('causation_audit_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('organization_audit_events_sequence_key').on(table.auditSequence),
    foreignKey({
      columns: [table.deploymentId, table.organizationVersion],
      foreignColumns: [organizationEpochs.deploymentId, organizationEpochs.organizationVersion],
      name: 'organization_audit_events_epoch_fkey',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.causationAuditId],
      foreignColumns: [table.auditId],
      name: 'organization_audit_events_causation_fkey',
    }).onDelete('restrict'),
    check('organization_audit_events_policy_version_check', sql`policy_version > 0`),
    check(
      'organization_audit_events_type_check',
      sql`event_type in (
        'organization.changed',
        'registration-policy.changed',
        'role.granted',
        'role.revoked',
        'exception.approved',
        'exception.expired',
        'exception.revoked',
        'compliance.transitioned',
        'entitlement.granted',
        'entitlement.revoked',
        'corporation-source.registered',
        'corporation-source.replaced',
        'corporation-source.revoked',
        'group.assigned',
        'group.revoked',
        'member.blocked',
        'member.unblocked'
      )`,
    ),
    check(
      'organization_audit_events_actor_check',
      sql`(actor_type in ('user', 'deployment_admin') and actor_id is not null)
        or (actor_type = 'system' and actor_id is null)`,
    ),
    check(
      'organization_audit_events_subject_type_check',
      sql`subject_type in (
        'deployment',
        'user',
        'character',
        'role_grant',
        'exception',
        'compliance',
        'corporation_source',
        'managed_corporation',
        'group',
        'external_service'
      )`,
    ),
    check(
      'organization_audit_events_subject_id_check',
      sql`length(trim(subject_id)) > 0 and length(subject_id) <= 255`,
    ),
    check(
      'organization_audit_events_reason_check',
      sql`length(trim(reason)) > 0 and length(reason) <= 2000`,
    ),
    check(
      'organization_audit_events_outcome_check',
      sql`outcome in ('granted', 'revoked', 'transitioned', 'denied', 'unchanged')`,
    ),
    check(
      'organization_audit_events_group_assignment_check',
      sql`(
          event_type in ('group.assigned', 'group.revoked')
          and group_id is not null
          and assignment_id is not null
          and target_user_id is not null
          and assignment_source in ('manual', 'compliance')
          and (
            (assignment_source = 'manual' and compliance_source is null)
            or (assignment_source = 'compliance' and compliance_source is not null)
          )
        ) or (
          event_type not in ('group.assigned', 'group.revoked')
          and group_id is null
          and assignment_id is null
          and target_user_id is null
          and assignment_source is null
          and compliance_source is null
          and entitlement_expires_at is null
        )`,
    ),
    index('organization_audit_events_version_sequence_idx').on(
      table.deploymentId,
      table.organizationVersion,
      table.auditSequence,
    ),
    index('organization_audit_events_subject_idx').on(
      table.deploymentId,
      table.organizationVersion,
      table.subjectType,
      table.subjectId,
      table.auditSequence,
    ),
  ],
)

export type OrganizationAuditEventRow = typeof organizationAuditEvents.$inferSelect
export type OrganizationMemberBlockRow = typeof organizationMemberBlocks.$inferSelect
