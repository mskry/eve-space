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
import { db, type DatabaseTransaction } from '../db/client.js'
import { domainEvents, type DomainEventRow } from '../db/schema.js'
import {
  relayFailureCategories,
  DomainEventValidationError,
  type DomainEventEnvelope,
  type RegisteredDomainEventInput,
  validateDomainEventInput,
  validateStoredDomainEvent,
} from './definitions.js'

type TransactionalDatabase = Pick<typeof db, 'transaction'>
type EventReader = Pick<typeof db, 'select'>
type EventWriter = Pick<typeof db, 'update'>
type EventDeleter = Pick<typeof db, 'delete'>

const claimOptions = z.object({
  claimTtlMs: z.number().int().positive(),
  limit: z.number().int().positive().max(1000),
  now: z.date().optional(),
})
const failureOptions = z.object({
  category: z.enum(relayFailureCategories),
  claimToken: z.uuid(),
  eventId: z.uuid(),
  now: z.date().optional(),
  retryDelayMs: z.number().int().nonnegative(),
})
const retentionOptions = z.object({
  now: z.date().optional(),
  retentionMs: z.number().int().positive(),
})
const redriveOptions = z
  .object({
    from: z.date(),
    limit: z.number().int().positive().max(1000),
    now: z.date().optional(),
    timeField: z.enum(['occurredAt', 'publishedAt']).default('publishedAt'),
    to: z.date(),
  })
  .refine((options) => options.from < options.to, {
    message: 'Re-drive start must be before its end',
  })
const redriveEventIds = z
  .array(z.uuid())
  .max(1000)
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
  transaction: Pick<DatabaseTransaction, 'insert'>,
  input: RegisteredDomainEventInput,
) {
  const event = validateDomainEventInput(input)
  const [stored] = await transaction
    .insert(domainEvents)
    .values({
      aggregateId: event.aggregateId,
      aggregateType: event.aggregateType,
      eventType: event.type,
      occurredAt: event.occurredAt,
      payload: event.payload,
      payloadVersion: event.payloadVersion,
    })
    .returning()
  if (!stored) {
    throw new Error('Failed to append domain event')
  }
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

    if (selected.length === 0) {
      return []
    }
    const selectedIds = selected.map((event) => event.eventId)
    const updated = await transaction
      .update(domainEvents)
      .set({
        claimExpiresAt,
        claimToken,
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
        claimExpiresAt,
        claimToken,
        event: toEnvelope(event),
        publishAttempts: event.publishAttempts,
        valid: true as const,
      }
    } catch (error) {
      if (!(error instanceof DomainEventValidationError)) {
        throw error
      }
      return {
        claimExpiresAt,
        claimToken,
        event: { eventId: event.eventId },
        publishAttempts: event.publishAttempts,
        valid: false as const,
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
      claimExpiresAt: null,
      claimToken: null,
      lastFailureAt: null,
      lastFailureCategory: null,
      publishedAt,
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
      claimExpiresAt: null,
      claimToken: null,
      lastFailureAt: failedAt,
      lastFailureCategory: parsed.category,
      nextAttemptAt: new Date(failedAt.getTime() + parsed.retryDelayMs),
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
      oldestPendingAt: min(domainEvents.pendingSince),
      pendingCount: count(),
    })
    .from(domainEvents)
    .where(isNull(domainEvents.publishedAt))
  return aggregate ?? { oldestPendingAt: null, pendingCount: 0 }
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
  if (parsedIds.length === 0) {
    return []
  }

  return database.transaction(async (transaction) => {
    const updated = await transaction
      .update(domainEvents)
      .set({
        claimExpiresAt: null,
        claimToken: null,
        lastFailureAt: null,
        lastFailureCategory: null,
        nextAttemptAt: now,
        pendingSince: now,
        publishedAt: null,
      })
      .where(
        and(
          inArray(domainEvents.eventId, parsedIds),
          isNotNull(domainEvents.publishedAt),
          isNull(domainEvents.claimToken),
        ),
      )
      .returning({ eventId: domainEvents.eventId })
    if (updated.length !== parsedIds.length) {
      throw new Error('Domain-event re-drive selection changed before mutation')
    }
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
    aggregateId: stored.aggregateId,
    aggregateType: stored.aggregateType,
    eventId: stored.eventId,
    eventSequence: stored.eventSequence,
    eventType: stored.eventType,
    occurredAt: stored.occurredAt,
    payload: stored.payload,
    payloadVersion: stored.payloadVersion,
  })
}
