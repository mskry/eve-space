import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { deploymentAdmins } from './deployment.js'
import { characters, users } from './identity.js'
import { platformSubjectLifecycles } from './installed-modules.js'

export const characterTransferPreviews = pgTable(
  'character_transfer_previews',
  {
    previewId: uuid('preview_id').defaultRandom().primaryKey().notNull(),
    administratorId: uuid('administrator_id').notNull(),
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
    reason: varchar({ length: 1000 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.administratorId],
      foreignColumns: [deploymentAdmins.id],
      name: 'character_transfer_previews_administrator_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.characterId],
      foreignColumns: [characters.characterId],
      name: 'character_transfer_previews_character_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.sourceUserId],
      foreignColumns: [users.id],
      name: 'character_transfer_previews_source_user_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.sourceSubjectLifecycleId],
      foreignColumns: [platformSubjectLifecycles.subjectLifecycleId],
      name: 'character_transfer_previews_source_subject_lifecycle_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.destinationUserId],
      foreignColumns: [users.id],
      name: 'character_transfer_previews_destination_user_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.destinationMainCharacterId],
      foreignColumns: [characters.characterId],
      name: 'character_transfer_previews_destination_main_character_id_fkey',
    }).onDelete('cascade'),
    check('character_transfer_previews_source_count_check', sql`source_character_count > 0`),
    check(
      'character_transfer_previews_reason_check',
      sql`reason = trim(reason) and length(reason) between 1 and 1000`,
    ),
    check(
      'character_transfer_previews_expiry_check',
      sql`expires_at = created_at + interval '5 minutes'`,
    ),
    check('character_transfer_previews_accounts_check', sql`source_user_id <> destination_user_id`),
    index('character_transfer_previews_expires_at_idx').on(table.expiresAt),
    index('character_transfer_previews_administrator_id_idx').on(table.administratorId),
  ],
)
