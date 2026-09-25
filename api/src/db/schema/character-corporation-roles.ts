import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgSequence,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { users } from './identity.js'
import { organizationEpochs } from './organization-epochs.js'
import { auditTimestamps } from './shared.js'

export type CorporationRoleObservationStatus = 'pending' | 'fresh' | 'degraded' | 'invalid'

export type CorporationRoleObservationInvalidationOutcome =
  | 'affiliation-changed'
  | 'authorization-generation-changed'
  | 'authorization-missing'
  | 'authorization-rejected'
  | 'authorization-revoked'
  | 'detached'
  | 'expired'
  | 'lifecycle-replaced'
  | 'missing-scope'
  | 'organization-replaced'
  | 'owner-mismatch'
  | 'transferred'

export const characterCorporationRoleObservationSequence = pgSequence(
  'character_corporation_role_observation_sequence',
  { startWith: 1 },
)

export const characterCorporationRoleObservations = pgTable(
  'character_corporation_role_observations',
  {
    affiliationPeriodRevision: uuid('affiliation_period_revision').notNull(),
    authorityCorporationId: bigint('authority_corporation_id', { mode: 'number' }).notNull(),
    authorizationGeneration: integer('authorization_generation').notNull(),
    characterId: bigint('character_id', { mode: 'number' }).notNull(),
    degradedUntil: timestamp('degraded_until', { withTimezone: true, mode: 'date' }),
    deploymentId: smallint('deployment_id').default(1).notNull(),
    esiFreshUntil: timestamp('esi_fresh_until', { withTimezone: true, mode: 'date' }),
    failureClass: text('failure_class'),
    freshUntil: timestamp('fresh_until', { withTimezone: true, mode: 'date' }),
    invalidatedAt: timestamp('invalidated_at', { withTimezone: true, mode: 'date' }),
    invalidationOutcome:
      text('invalidation_outcome').$type<CorporationRoleObservationInvalidationOutcome>(),
    lastAppliedObservationSequence: bigint('last_applied_observation_sequence', {
      mode: 'bigint',
    }).notNull(),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true, mode: 'date' }).notNull(),
    nextRefreshAt: timestamp('next_refresh_at', { withTimezone: true, mode: 'date' }),
    observationId: uuid('observation_id').defaultRandom().primaryKey().notNull(),
    observedAllianceId: bigint('observed_alliance_id', { mode: 'number' }),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    requiredScope: text('required_scope').notNull(),
    roleRevision: uuid('role_revision'),
    sourceSubjectLifecycleId: uuid('source_subject_lifecycle_id').notNull(),
    status: text().$type<CorporationRoleObservationStatus>().notNull(),
    userId: uuid('user_id').notNull(),
    validatedAt: timestamp('validated_at', { withTimezone: true, mode: 'date' }),
    ...auditTimestamps(),
  },
  (table) => [
    foreignKey({
      columns: [table.deploymentId, table.organizationVersion],
      foreignColumns: [organizationEpochs.deploymentId, organizationEpochs.organizationVersion],
      name: 'character_corporation_role_observations_epoch_fkey',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'character_corporation_role_observations_user_fkey',
    }).onDelete('restrict'),
    check(
      'character_corporation_role_observations_identity_check',
      sql`character_id > 0 and authority_corporation_id > 0`,
    ),
    check(
      'character_corporation_role_observations_authorization_generation_check',
      sql`authorization_generation >= 0`,
    ),
    check(
      'character_corporation_role_observations_required_scope_check',
      sql`length(trim(required_scope)) > 0`,
    ),
    check(
      'character_corporation_role_observations_sequence_check',
      sql`last_applied_observation_sequence > 0`,
    ),
    check(
      'character_corporation_role_observations_status_check',
      sql`status in ('pending', 'fresh', 'degraded', 'invalid')`,
    ),
    uniqueIndex('character_corporation_role_observations_binding_key').on(
      table.deploymentId,
      table.organizationVersion,
      table.sourceSubjectLifecycleId,
      table.affiliationPeriodRevision,
      table.authorityCorporationId,
      table.authorizationGeneration,
    ),
    uniqueIndex('character_corporation_role_observations_current_key')
      .on(table.deploymentId, table.organizationVersion, table.characterId)
      .where(sql`status <> 'invalid'`),
    index('character_corporation_role_observations_due_idx')
      .on(table.nextRefreshAt, table.characterId)
      .where(sql`status <> 'invalid'`),
    index('character_corporation_role_observations_character_idx').on(
      table.characterId,
      table.organizationVersion,
    ),
  ],
)

export const characterCorporationRoleContents = pgTable(
  'character_corporation_role_contents',
  {
    observationId: uuid('observation_id').primaryKey().notNull(),
    roles: text().array().notNull(),
    rolesAtBase: text('roles_at_base').array().notNull(),
    rolesAtHeadquarters: text('roles_at_hq').array().notNull(),
    rolesAtOther: text('roles_at_other').array().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.observationId],
      foreignColumns: [characterCorporationRoleObservations.observationId],
      name: 'character_corporation_role_contents_observation_fkey',
    }).onDelete('cascade'),
  ],
)
