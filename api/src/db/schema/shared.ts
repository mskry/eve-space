import { sql } from 'drizzle-orm'
import { check, timestamp } from 'drizzle-orm/pg-core'

/** Fresh builders per call; a builder instance must not be shared between tables. */
export function auditTimestamps() {
  return {
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  }
}

export function moduleIdCheck(name: string) {
  return check(
    name,
    sql`module_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length(module_id) <= 44 and module_id not in ('core', 'platform')`,
  )
}
