import { sql } from 'drizzle-orm'
import { check, timestamp } from 'drizzle-orm/pg-core'

/** Fresh builders per call; a builder instance must not be shared between tables. */
export function auditTimestamps() {
  return {
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  }
}

export function moduleIdCheck(name: string) {
  return check(name, sql`is_valid_module_id(module_id)`)
}
