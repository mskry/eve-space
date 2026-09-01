import { randomUUID } from 'node:crypto'
import {
  and,
  asc,
  count,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  min,
  or,
  sql,
} from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { domainEvents, type DomainEventRow } from '../db/schema.js'
import {
  relayFailureCategories,
  DomainEventValidationError,
  type DomainEventEnvelope,
  type RegisteredDomainEventInput,
  validateDomainEventInput,
  validateStoredDomainEvent,
} from './definitions.js'

export type DomainEventTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type TransactionalDatabase = Pick<typeof db, 'transaction'>
type EventReader = Pick<typeof db, 'select'>
type EventWriter = Pick<typeof db, 'update'>
type EventDeleter = Pick<typeof db, 'delete'>

const claimOptions = z.object({
  limit: z.number().int().positive().max(1_000),
  claimTtlMs: z.number().int().positive(),
  now: z.date().optional(),
})
const failureOptions = z.object({
  eventId: z.uuid(),
  claimToken: z.uuid(),
  category: z.enum(relayFailureCategories),
  retryDelayMs: z.number().int().nonnegative(),
  now: z.date().optional(),
})
const retentionOptions = z.object({
  retentionMs: z.number().int().positive(),
  now: z.date().optional(),
})
const redriveOptions = z
  .object({
    from: z.date(),
    to: z.date(),
    limit: z.number().int().positive().max(1_000),
    timeField: z.enum(['occurredAt', 'publishedAt']).default('publishedAt'),
    now: z.date().optional(),
  })
  .refine((options) => options.from < options.to, {
    message: 'Re-drive start must be before its end',
  })
const redriveEventIds = z
  .array(z.uuid())
  .max(1_000)
  .refine((eventIds) => new Set(eventIds).size === eventIds.length, {
    message: 'Re-drive event IDs must be unique',
  })

interface DomainEventClaim {
  claimToken: string
  claimExpiresAt: Date
  publishAttempts: number
}

export type ClaimedDomainEvent =
  | (DomainEventClaim & { valid: true; event: DomainEventEnvelope })
  | (DomainEventClaim & { valid: false; event: { eventId: string } })

export async function appendDomainEvent(
  transaction: Pick<DomainEventTransaction, 'insert'>,
  input: RegisteredDomainEventInput,
) {
  const event = validateDomainEventInput(input)
  const [stored] = await transaction
    .insert(domainEvents)
    .values({
      eventType: event.type,
      payloadVersion: event.payloadVersion,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: event.payload,
      occurredAt: event.occurredAt,
    })
    .returning()
  if (!stored) throw new Error('Failed to append domain event')
  return toEnvelope(stored)
}

export async function loadDomainEvent(eventId: string, connection: EventReader = db) {
  const parsedId = z.uuid().parse(eventId)
  const [stored] = await connection
    .select()
    .from(domainEvents)
    .where(eq(domainEvents.eventId, parsedId))
  return stored ? toEnvelope(stored) : null
}

export async function claimPendingDomainEvents(
  options: z.input<typeof claimOptions>,
  database: TransactionalDatabase = db,
): Promise<ClaimedDomainEvent[]> {
  const parsed = claimOptions.parse(options)
  const now = parsed.now ?? new Date()
  const claimToken = randomUUID()
  const claimExpiresAt = new Date(now.getTime() + parsed.claimTtlMs)

  const claimed = await database.transaction(async (transaction) => {
    const selected = await transaction
      .select({ eventId: domainEvents.eventId, eventSequence: domainEvents.eventSequence })
      .from(domainEvents)
      .where(
        and(
          isNull(domainEvents.publishedAt),
          lte(domainEvents.nextAttemptAt, now),
          or(
            isNull(domainEvents.claimToken),
            and(isNotNull(domainEvents.claimToken), lte(domainEvents.claimExpiresAt, now)),
          ),
        ),
      )
      .orderBy(
        sql`case when ${domainEvents.lastFailureCategory} = 'invalid-event' then 1 else 0 end`,
        asc(domainEvents.eventSequence),
      )
      .limit(parsed.limit)
      .for('update', { skipLocked: true })

    if (selected.length === 0) return []
    const selectedIds = selected.map((event) => event.eventId)
    const updated = await transaction
      .update(domainEvents)
      .set({
        claimToken,
        claimExpiresAt,
        publishAttempts: sql`${domainEvents.publishAttempts} + 1`,
      })
      .where(and(inArray(domainEvents.eventId, selectedIds), isNull(domainEvents.publishedAt)))
      .returning()
    const byId = new Map(updated.map((event) => [event.eventId, event]))
    return selectedIds.map((eventId) => byId.get(eventId)).filter((event) => event !== undefined)
  })

  return claimed.map((event) => {
    try {
      return {
        valid: true as const,
        event: toEnvelope(event),
        claimToken,
        claimExpiresAt,
        publishAttempts: event.publishAttempts,
      }
    } catch (error) {
      if (!(error instanceof DomainEventValidationError)) throw error
      return {
        valid: false as const,
        event: { eventId: event.eventId },
        claimToken,
        claimExpiresAt,
        publishAttempts: event.publishAttempts,
      }
    }
  })
}

export async function markDomainEventPublished(
  eventId: string,
  claimToken: string,
  publishedAt = new Date(),
  database: EventWriter = db,
) {
  const [updated] = await database
    .update(domainEvents)
    .set({
      publishedAt,
      claimToken: null,
      claimExpiresAt: null,
      lastFailureCategory: null,
      lastFailureAt: null,
    })
    .where(
      and(
        eq(domainEvents.eventId, z.uuid().parse(eventId)),
        eq(domainEvents.claimToken, z.uuid().parse(claimToken)),
        isNull(domainEvents.publishedAt),
      ),
    )
    .returning({ eventId: domainEvents.eventId })
  return Boolean(updated)
}

export async function recordDomainEventPublishFailure(
  options: z.input<typeof failureOptions>,
  database: EventWriter = db,
) {
  const parsed = failureOptions.parse(options)
  const failedAt = parsed.now ?? new Date()
  const [updated] = await database
    .update(domainEvents)
    .set({
      nextAttemptAt: new Date(failedAt.getTime() + parsed.retryDelayMs),
      claimToken: null,
      claimExpiresAt: null,
      lastFailureCategory: parsed.category,
      lastFailureAt: failedAt,
    })
    .where(
      and(
        eq(domainEvents.eventId, parsed.eventId),
        eq(domainEvents.claimToken, parsed.claimToken),
        isNull(domainEvents.publishedAt),
      ),
    )
    .returning({ eventId: domainEvents.eventId })
  return Boolean(updated)
}

export async function getPendingDomainEventAggregates(connection: EventReader = db) {
  const [aggregate] = await connection
    .select({
      pendingCount: count(),
      oldestPendingAt: min(domainEvents.pendingSince),
    })
    .from(domainEvents)
    .where(isNull(domainEvents.publishedAt))
  return aggregate ?? { pendingCount: 0, oldestPendingAt: null }
}

export async function deletePublishedDomainEvents(
  options: z.input<typeof retentionOptions>,
  database: EventDeleter = db,
) {
  const parsed = retentionOptions.parse(options)
  const cutoff = new Date((parsed.now ?? new Date()).getTime() - parsed.retentionMs)
  const deleted = await database
    .delete(domainEvents)
    .where(
      and(
        isNotNull(domainEvents.publishedAt),
        lt(domainEvents.publishedAt, cutoff),
        isNull(domainEvents.claimToken),
      ),
    )
    .returning({ eventId: domainEvents.eventId })
  return deleted.length
}

export async function listPublishedDomainEventIdsForRedrive(
  options: z.input<typeof redriveOptions>,
  connection: EventReader = db,
) {
  const parsed = redriveOptions.parse(options)
  const timeColumn =
    parsed.timeField === 'occurredAt' ? domainEvents.occurredAt : domainEvents.publishedAt
  const selected = await connection
    .select({ eventId: domainEvents.eventId })
    .from(domainEvents)
    .where(
      and(
        isNotNull(domainEvents.publishedAt),
        isNull(domainEvents.claimToken),
        gte(timeColumn, parsed.from),
        lt(timeColumn, parsed.to),
      ),
    )
    .orderBy(asc(domainEvents.eventSequence))
    .limit(parsed.limit)
  return selected.map((event) => event.eventId)
}

export async function redrivePublishedDomainEvents(
  eventIds: readonly string[],
  now = new Date(),
  database: TransactionalDatabase = db,
) {
  const parsedIds = redriveEventIds.parse(eventIds)
  if (parsedIds.length === 0) return []

  return database.transaction(async (transaction) => {
    const updated = await transaction
      .update(domainEvents)
      .set({
        publishedAt: null,
        pendingSince: now,
        nextAttemptAt: now,
        claimToken: null,
        claimExpiresAt: null,
        lastFailureCategory: null,
        lastFailureAt: null,
      })
      .where(
        and(
          inArray(domainEvents.eventId, parsedIds),
          isNotNull(domainEvents.publishedAt),
          isNull(domainEvents.claimToken),
        ),
      )
      .returning({ eventId: domainEvents.eventId })
    if (updated.length !== parsedIds.length)
      throw new Error('Domain-event re-drive selection changed before mutation')
    return parsedIds
  })
}

export async function countPublishedDomainEventsForRedrive(
  options: z.input<typeof redriveOptions>,
  connection: EventReader = db,
) {
  const parsed = redriveOptions.parse(options)
  const timeColumn =
    parsed.timeField === 'occurredAt' ? domainEvents.occurredAt : domainEvents.publishedAt
  const [aggregate] = await connection
    .select({ matchingCount: count() })
    .from(domainEvents)
    .where(
      and(
        isNotNull(domainEvents.publishedAt),
        isNull(domainEvents.claimToken),
        gte(timeColumn, parsed.from),
        lt(timeColumn, parsed.to),
      ),
    )
  return Math.min(aggregate?.matchingCount ?? 0, parsed.limit)
}

function toEnvelope(stored: DomainEventRow) {
  return validateStoredDomainEvent({
    eventId: stored.eventId,
    eventSequence: stored.eventSequence,
    eventType: stored.eventType,
    payloadVersion: stored.payloadVersion,
    aggregateType: stored.aggregateType,
    aggregateId: stored.aggregateId,
    payload: stored.payload,
    occurredAt: stored.occurredAt,
  })
}
