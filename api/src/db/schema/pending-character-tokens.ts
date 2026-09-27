import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { characters, eveTokens } from './identity.js'
import { platformSubjectLifecycles } from './installed-modules.js'

export const pendingCharacterTokens = pgTable(
  'pending_character_tokens',
  {
    characterId: bigint('character_id', { mode: 'number' }).primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    subjectLifecycleId: uuid('subject_lifecycle_id').notNull(),
    baseTokenVersion: integer('base_token_version').notNull(),
    attemptId: uuid('attempt_id').defaultRandom().notNull(),
    encryptedTokens: text('encrypted_tokens').notNull(),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => [
    check('pending_character_tokens_base_version_check', sql`base_token_version >= 0`),
    check('pending_character_tokens_encrypted_tokens_check', sql`length(encrypted_tokens) > 0`),
    foreignKey({
      columns: [table.characterId],
      foreignColumns: [eveTokens.characterId],
      name: 'pending_character_tokens_verified_token_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.userId, table.characterId],
      foreignColumns: [characters.userId, characters.characterId],
      name: 'pending_character_tokens_owner_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.subjectLifecycleId, table.characterId],
      foreignColumns: [
        platformSubjectLifecycles.subjectLifecycleId,
        platformSubjectLifecycles.characterId,
      ],
      name: 'pending_character_tokens_lifecycle_fkey',
    }).onDelete('cascade'),
  ],
)
