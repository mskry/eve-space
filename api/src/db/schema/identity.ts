import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { auditTimestamps } from './shared.js'
import { organizationEpochs } from './organization-epochs.js'

export type AuthorizationIntent = 'login' | 'attach' | 'reauthorize' | 'claim-organization-owner'

export const users = pgTable('users', {
  id: uuid().defaultRandom().primaryKey().notNull(),
  ...auditTimestamps(),
})

export const characters = pgTable(
  'characters',
  {
    characterId: bigint('character_id', { mode: 'number' }).primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    name: text().notNull(),
    corporationId: bigint('corporation_id', { mode: 'number' }).notNull(),
    allianceId: bigint('alliance_id', { mode: 'number' }),
    affiliationCheckedAt: timestamp('affiliation_checked_at', { withTimezone: true, mode: 'date' }),
    nextAffiliationCheck: timestamp('next_affiliation_check', {
      withTimezone: true,
      mode: 'date',
    }),
    affiliationResolutionState: text('affiliation_resolution_state')
      .$type<'pending' | 'resolved' | 'unresolvable'>()
      .default('pending')
      .notNull(),
    isMain: boolean('is_main').default(false).notNull(),
    ...auditTimestamps(),
  },
  (table) => [
    uniqueIndex('one_main_character_per_user')
      .using('btree', table.userId.asc().nullsLast().op('uuid_ops'))
      .where(sql`is_main`),
    uniqueIndex('characters_user_character_key').on(table.userId, table.characterId),
    index('characters_due_affiliation_check_idx')
      .on(table.nextAffiliationCheck, table.characterId)
      .where(
        sql`next_affiliation_check is not null and affiliation_resolution_state <> 'unresolvable'`,
      ),
    check(
      'characters_affiliation_resolution_state_check',
      sql`affiliation_resolution_state in ('pending', 'resolved', 'unresolvable')`,
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'characters_user_id_fkey',
    }).onDelete('cascade'),
  ],
)

export const sessions = pgTable(
  'sessions',
  {
    sessionHash: varchar('session_hash', { length: 64 }).primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    check('sessions_session_hash_length_check', sql`length(session_hash) = 64`),
    index('sessions_expires_at_idx').using(
      'btree',
      table.expiresAt.asc().nullsLast().op('timestamptz_ops'),
    ),
    index('sessions_user_id_idx').using('btree', table.userId.asc().nullsLast().op('uuid_ops')),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'sessions_user_id_fkey',
    }).onDelete('cascade'),
  ],
)

export const oauthStates = pgTable(
  'oauth_states',
  {
    stateHash: varchar('state_hash', { length: 64 }).primaryKey().notNull(),
    intent: text().$type<AuthorizationIntent>().default('login').notNull(),
    userId: uuid('user_id'),
    characterId: bigint('character_id', { mode: 'number' }),
    organizationDeploymentId: smallint('organization_deployment_id'),
    organizationId: bigint('organization_id', { mode: 'number' }),
    organizationVersion: bigint('organization_version', { mode: 'number' }),
    returnPath: varchar('return_path', { length: 512 }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    check('oauth_states_state_hash_length_check', sql`length(state_hash) = 64`),
    index('oauth_states_expires_at_idx').using(
      'btree',
      table.expiresAt.asc().nullsLast().op('timestamptz_ops'),
    ),
    index('oauth_states_user_id_idx')
      .using('btree', table.userId.asc().nullsLast().op('uuid_ops'))
      .where(sql`user_id is not null`),
    index('oauth_states_character_id_idx')
      .using('btree', table.characterId.asc().nullsLast().op('int8_ops'))
      .where(sql`character_id is not null`),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'oauth_states_user_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.characterId],
      foreignColumns: [characters.characterId],
      name: 'oauth_states_character_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationDeploymentId, table.organizationVersion, table.organizationId],
      foreignColumns: [
        organizationEpochs.deploymentId,
        organizationEpochs.organizationVersion,
        organizationEpochs.organizationId,
      ],
      name: 'oauth_states_organization_epoch_fkey',
    }).onDelete('cascade'),
    index('oauth_states_organization_epoch_idx')
      .on(table.organizationDeploymentId, table.organizationVersion)
      .where(sql`organization_deployment_id is not null`),
    check(
      'oauth_states_intent_check',
      sql`intent in ('login', 'attach', 'reauthorize', 'claim-organization-owner')`,
    ),
    check(
      'oauth_states_context_check',
      sql`(
          intent = 'login'
          and user_id is null
          and character_id is null
          and organization_deployment_id is null
          and organization_id is null
          and organization_version is null
        )
        or (
          intent = 'attach'
          and user_id is not null
          and character_id is null
          and organization_deployment_id is null
          and organization_id is null
          and organization_version is null
        )
        or (
          intent = 'reauthorize'
          and user_id is not null
          and character_id is not null
          and organization_deployment_id is null
          and organization_id is null
          and organization_version is null
        )
        or (
          intent = 'claim-organization-owner'
          and user_id is not null
          and character_id is not null
          and organization_deployment_id = 1
          and organization_id is not null
          and organization_version is not null
        )`,
    ),
    check(
      'oauth_states_return_path_context_check',
      sql`return_path is null or intent = 'reauthorize'`,
    ),
  ],
)

export const eveTokens = pgTable(
  'eve_tokens',
  {
    characterId: bigint('character_id', { mode: 'number' }).primaryKey().notNull(),
    encryptedTokens: text('encrypted_tokens').notNull(),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    scopes: jsonb().$type<string[]>().default([]).notNull(),
    tokenVersion: integer('token_version').default(0).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.characterId],
      foreignColumns: [characters.characterId],
      name: 'eve_tokens_character_id_fkey',
    }).onDelete('cascade'),
    check('eve_tokens_scopes_is_array', sql`jsonb_typeof(scopes) = 'array'::text`),
  ],
)
