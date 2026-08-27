import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type {
  DomainEventAggregateType,
  DomainEventPayload,
  DomainEventType,
  RelayFailureCategory,
} from '../../domain-events.js'

export const domainEvents = pgTable(
  'domain_events',
  {
    eventId: uuid('event_id').defaultRandom().primaryKey().notNull(),
    eventSequence: bigint('event_sequence', { mode: 'bigint' })
      .generatedAlwaysAsIdentity()
      .notNull(),
    eventType: text('event_type').$type<DomainEventType>().notNull(),
    payloadVersion: integer('payload_version').notNull(),
    aggregateType: text('aggregate_type').$type<DomainEventAggregateType>().notNull(),
    aggregateId: text('aggregate_id').notNull(),
    payload: jsonb().$type<DomainEventPayload>().notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    pendingSince: timestamp('pending_since', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .notNull(),
    claimToken: uuid('claim_token'),
    claimExpiresAt: timestamp('claim_expires_at', { withTimezone: true, mode: 'date' }),
    publishAttempts: integer('publish_attempts').default(0).notNull(),
    lastFailureCategory: text('last_failure_category').$type<RelayFailureCategory>(),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true, mode: 'date' }),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('domain_events_event_sequence_key').on(table.eventSequence),
    index('domain_events_pending_eligible_idx')
      .on(table.nextAttemptAt, table.eventSequence)
      .where(sql`published_at is null`),
    index('domain_events_published_retention_idx')
      .on(table.publishedAt)
      .where(sql`published_at is not null`),
    check('domain_events_payload_version_check', sql`payload_version > 0`),
    check('domain_events_publish_attempts_check', sql`publish_attempts >= 0`),
    check('domain_events_payload_object_check', sql`jsonb_typeof(payload) = 'object'`),
    check('domain_events_event_type_check', sql`event_type <> ''`),
    check(
      'domain_events_aggregate_identity_check',
      sql`aggregate_type <> '' and aggregate_id <> ''`,
    ),
    check(
      'domain_events_claim_pair_check',
      sql`(claim_token is null) = (claim_expires_at is null)`,
    ),
    check(
      'domain_events_failure_pair_check',
      sql`(last_failure_category is null) = (last_failure_at is null)`,
    ),
    check(
      'domain_events_failure_category_check',
      sql`last_failure_category is null or last_failure_category in ('queue-unavailable', 'queue-rejected', 'invalid-event', 'unknown')`,
    ),
    check('domain_events_published_claim_check', sql`published_at is null or claim_token is null`),
  ],
)

export type DomainEventRow = typeof domainEvents.$inferSelect
