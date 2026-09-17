import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import { eveTokens } from './identity.js'
import { deploymentModuleSections } from './installed-modules.js'

export const characterReviewerDisclosureAcceptances = pgTable(
  'character_reviewer_disclosure_acceptances',
  {
    characterId: bigint('character_id', { mode: 'number' }).notNull(),
    moduleId: text('module_id').notNull(),
    sectionId: text('section_id').notNull(),
    disclosureVersion: integer('disclosure_version').notNull(),
    authorizationGeneration: integer('authorization_generation').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.characterId, table.moduleId, table.sectionId],
      name: 'character_reviewer_disclosure_acceptances_pkey',
    }),
    foreignKey({
      columns: [table.characterId],
      foreignColumns: [eveTokens.characterId],
      name: 'character_reviewer_disclosure_acceptances_character_id_fkey',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.moduleId, table.sectionId],
      foreignColumns: [deploymentModuleSections.moduleId, deploymentModuleSections.sectionId],
      name: 'character_reviewer_disclosure_acceptances_section_fkey',
    }).onDelete('cascade'),
    check(
      'character_reviewer_disclosure_acceptances_versions_check',
      sql`disclosure_version > 0 and authorization_generation >= 0`,
    ),
  ],
)
