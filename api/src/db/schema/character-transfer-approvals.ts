import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export type CharacterTransferAuditAction = 'created' | 'revoked' | 'consumed'

export const characterTransferApprovals = pgTable(
  'character_transfer_approvals',
  {
    approvalId: uuid('approval_id').defaultRandom().primaryKey().notNull(),
    linkSecretHash: varchar('link_secret_hash', { length: 64 }).notNull().unique(),
    characterId: bigint('character_id', { mode: 'number' }).notNull(),
    characterName: text('character_name').notNull(),
    sourceUserId: uuid('source_user_id').notNull(),
    sourceSubjectLifecycleId: uuid('source_subject_lifecycle_id').notNull(),
    sourceCharacterCount: integer('source_character_count').notNull(),
    destinationUserId: uuid('destination_user_id').notNull(),
    destinationMainCharacterId: bigint('destination_main_character_id', {
      mode: 'number',
    }).notNull(),
    destinationMainCharacterName: text('destination_main_character_name').notNull(),
    approvedByAdministratorId: uuid('approved_by_administrator_id').notNull(),
    reason: varchar({ length: 1000 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
    consumedByUserId: uuid('consumed_by_user_id'),
    newSubjectLifecycleId: uuid('new_subject_lifecycle_id'),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revokedByAdministratorId: uuid('revoked_by_administrator_id'),
    revocationReason: varchar('revocation_reason', { length: 1000 }),
  },
  (table) => [
    check(
      'character_transfer_approvals_secret_hash_check',
      sql`link_secret_hash ~ '^[0-9a-f]{64}$'`,
    ),
    check('character_transfer_approvals_source_count_check', sql`source_character_count > 0`),
    check(
      'character_transfer_approvals_reason_check',
      sql`reason = trim(reason) and length(reason) between 1 and 1000`,
    ),
    check(
      'character_transfer_approvals_expiry_check',
      sql`expires_at = created_at + interval '15 minutes'`,
    ),
    check(
      'character_transfer_approvals_accounts_check',
      sql`source_user_id <> destination_user_id`,
    ),
    check(
      'character_transfer_approvals_consumed_check',
      sql`(consumed_at is null and consumed_by_user_id is null and new_subject_lifecycle_id is null) or (consumed_at is not null and consumed_by_user_id = destination_user_id and new_subject_lifecycle_id is not null and consumed_at >= created_at)`,
    ),
    check(
      'character_transfer_approvals_revoked_check',
      sql`(revoked_at is null and revoked_by_administrator_id is null and revocation_reason is null) or (revoked_at is not null and revoked_by_administrator_id is not null and revocation_reason is not null and revocation_reason = trim(revocation_reason) and length(revocation_reason) between 1 and 1000 and revoked_at >= created_at)`,
    ),
    check(
      'character_transfer_approvals_terminal_state_check',
      sql`consumed_at is null or revoked_at is null`,
    ),
    index('character_transfer_approvals_character_lifecycle_idx').on(
      table.characterId,
      table.sourceSubjectLifecycleId,
    ),
    index('character_transfer_approvals_destination_user_id_idx').on(table.destinationUserId),
  ],
)

export const characterTransferAudit = pgTable(
  'character_transfer_audit',
  {
    auditId: uuid('audit_id').defaultRandom().primaryKey().notNull(),
    approvalId: uuid('approval_id').notNull(),
    action: text().$type<CharacterTransferAuditAction>().notNull(),
    approvedByAdministratorId: uuid('approved_by_administrator_id').notNull(),
    actionAdministratorId: uuid('action_administrator_id'),
    actingDestinationUserId: uuid('acting_destination_user_id'),
    characterId: bigint('character_id', { mode: 'number' }).notNull(),
    sourceUserId: uuid('source_user_id').notNull(),
    sourceSubjectLifecycleId: uuid('source_subject_lifecycle_id').notNull(),
    destinationUserId: uuid('destination_user_id').notNull(),
    newSubjectLifecycleId: uuid('new_subject_lifecycle_id'),
    sourceEventId: uuid('source_event_id'),
    destinationEventId: uuid('destination_event_id'),
    reason: varchar({ length: 1000 }).notNull(),
    outcome: text().$type<CharacterTransferAuditAction>().notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('character_transfer_audit_approval_id_idx').on(table.approvalId, table.occurredAt),
    index('character_transfer_audit_character_id_idx').on(table.characterId, table.occurredAt),
    check(
      'character_transfer_audit_action_check',
      sql`action in ('created', 'revoked', 'consumed')`,
    ),
    check(
      'character_transfer_audit_outcome_check',
      sql`outcome in ('created', 'revoked', 'consumed')`,
    ),
    check(
      'character_transfer_audit_reason_check',
      sql`reason = trim(reason) and length(reason) between 1 and 1000`,
    ),
    check('character_transfer_audit_accounts_check', sql`source_user_id <> destination_user_id`),
  ],
)
