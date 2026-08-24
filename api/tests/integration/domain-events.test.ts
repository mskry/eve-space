import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import {
  appendDomainEvent,
  claimPendingDomainEvents,
  deletePublishedDomainEvents,
  getPendingDomainEventAggregates,
  listPublishedDomainEventIdsForRedrive,
  loadDomainEvent,
  markDomainEventPublished,
  redrivePublishedDomainEvents,
  recordDomainEventPublishFailure,
} from '../../src/domain-event-store.js'
import { runMigrations } from '../../src/db/migration-runner.js'
import * as schema from '../../src/db/schema.js'
import { runOutboxRelayBatch } from '../../src/queue/outbox-relay.js'

let container: StartedTestContainer
let databaseUrl: string

beforeAll(async () => {
  container = await new GenericContainer('postgres:17-alpine')
    .withEnvironment({
      POSTGRES_DB: 'eve_space',
      POSTGRES_PASSWORD: 'eve_space',
      POSTGRES_USER: 'eve_space',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/))
    .start()
  databaseUrl = `postgres://eve_space:eve_space@${container.getHost()}:${container.getMappedPort(5432)}/eve_space`
  await waitForDatabase(databaseUrl)
})

afterAll(async () => {
  await container?.stop()
})

beforeEach(async () => {
  const connection = postgres(databaseUrl)
  try {
    await connection.unsafe('drop schema public cascade; create schema public;').simple()
    await runMigrations(connection)
  } finally {
    await connection.end()
  }
})

describe('domain event PostgreSQL persistence', () => {
  test('creates the constrained and indexed immutable event table', async () => {
    const connection = postgres(databaseUrl)
    try {
      const constraints = await connection<{ conname: string }[]>`
        select conname
        from pg_constraint
        where conrelid = 'domain_events'::regclass
        order by conname
      `
      expect(constraints.map(({ conname }) => conname)).toEqual(
        expect.arrayContaining([
          'domain_events_pkey',
          'domain_events_event_sequence_key',
          'domain_events_payload_version_check',
          'domain_events_publish_attempts_check',
          'domain_events_claim_pair_check',
          'domain_events_published_claim_check',
        ]),
      )
      const indexes = await connection<{ indexname: string; indexdef: string }[]>`
        select indexname, indexdef from pg_indexes
        where schemaname = current_schema() and tablename = 'domain_events'
      `
      expect(indexes.map(({ indexname }) => indexname)).toEqual(
        expect.arrayContaining([
          'domain_events_pending_eligible_idx',
          'domain_events_published_retention_idx',
        ]),
      )
      expect(
        indexes.find(({ indexname }) => indexname === 'domain_events_pending_eligible_idx')
          ?.indexdef,
      ).toContain('WHERE (published_at IS NULL)')
      expect(indexes.map(({ indexname }) => indexname)).not.toContain(
        'domain_events_pending_expired_claim_idx',
      )

      await expect(
        connection`
          insert into domain_events (
            event_type, payload_version, aggregate_type, aggregate_id, payload
          ) values ('character.attached', 0, 'character', '1', ${connection.json({})})
        `,
      ).rejects.toMatchObject({ constraint_name: 'domain_events_payload_version_check' })

      const [event] = await connection<{ event_id: string }[]>`
        insert into domain_events (
          event_type, payload_version, aggregate_type, aggregate_id, payload
        ) values (
          'character.attached', 1, 'character', '1404328063',
          ${connection.json(characterSnapshot([]))}
        ) returning event_id
      `
      await expect(
        connection`
          update domain_events set claim_token = gen_random_uuid() where event_id = ${event!.event_id}
        `,
      ).rejects.toMatchObject({ constraint_name: 'domain_events_claim_pair_check' })
      await expect(
        connection`
          update domain_events set aggregate_id = 'changed' where event_id = ${event!.event_id}
        `,
      ).rejects.toThrow('domain event envelope is immutable')
    } finally {
      await connection.end()
    }
  })

  test('commits and rolls back mutation and event as one transaction', async () => {
    const connection = postgres(databaseUrl)
    const database = drizzle(connection, { schema })
    try {
      await database.transaction(async (transaction) => {
        await transaction.insert(schema.users).values({ id: userId })
        await appendDomainEvent(transaction, attachedEventInput())
      })

      const committed = await connection<{ users: number; events: number }[]>`
        select
          (select count(*)::integer from users) as users,
          (select count(*)::integer from domain_events) as events
      `
      expect(committed[0]).toEqual({ users: 1, events: 1 })

      await expect(
        database.transaction(async (transaction) => {
          await transaction.insert(schema.users).values({ id: rollbackUserId })
          await appendDomainEvent(transaction, {
            ...attachedEventInput(),
            aggregateId: '1404328064',
            payload: { ...characterSnapshot([]), userId: rollbackUserId, characterId: 1404328064 },
          })
          throw new Error('rollback probe')
        }),
      ).rejects.toThrow('rollback probe')

      const rolledBack = await connection<{ users: number; events: number }[]>`
        select
          (select count(*)::integer from users) as users,
          (select count(*)::integer from domain_events) as events
      `
      expect(rolledBack[0]).toEqual({ users: 1, events: 1 })
    } finally {
      await connection.end()
    }
  })

  test('excludes concurrent claimers across independent connections', async () => {
    const setup = postgres(databaseUrl)
    const first = postgres(databaseUrl)
    const second = postgres(databaseUrl)
    try {
      await appendEvents(drizzle(setup, { schema }), 3)
      const now = new Date(Date.now() + 1_000)
      const [firstClaims, secondClaims] = await Promise.all([
        claimPendingDomainEvents({ limit: 2, claimTtlMs: 30_000, now }, drizzle(first, { schema })),
        claimPendingDomainEvents(
          { limit: 2, claimTtlMs: 30_000, now },
          drizzle(second, { schema }),
        ),
      ])
      const eventIds = [...firstClaims, ...secondClaims].map(({ event }) => event.eventId)
      expect(eventIds).toHaveLength(3)
      expect(new Set(eventIds)).toHaveLength(3)
    } finally {
      await Promise.all([setup.end(), first.end(), second.end()])
    }
  })

  test('recovers expired claims with a new token and incremented attempt', async () => {
    const connection = postgres(databaseUrl)
    const database = drizzle(connection, { schema })
    try {
      await appendEvents(database, 1)
      const now = new Date(Date.now() + 1_000)
      const [first] = await claimPendingDomainEvents({ limit: 1, claimTtlMs: 1_000, now }, database)
      expect(first?.publishAttempts).toBe(1)
      await expect(
        claimPendingDomainEvents(
          { limit: 1, claimTtlMs: 1_000, now: new Date(now.getTime() + 999) },
          database,
        ),
      ).resolves.toEqual([])

      const [recovered] = await claimPendingDomainEvents(
        { limit: 1, claimTtlMs: 1_000, now: new Date(now.getTime() + 1_000) },
        database,
      )
      expect(recovered?.event.eventId).toBe(first?.event.eventId)
      expect(recovered?.claimToken).not.toBe(first?.claimToken)
      expect(recovered?.publishAttempts).toBe(2)
    } finally {
      await connection.end()
    }
  })

  test('isolates incompatible stored rows from valid relay companions', async () => {
    const connection = postgres(databaseUrl)
    const database = drizzle(connection, { schema })
    const subject = relayQueue(async () => undefined)
    try {
      const [invalid] = await connection<{ event_id: string }[]>`
        insert into domain_events (
          event_type, payload_version, aggregate_type, aggregate_id, payload
        ) values ('future.event', 1, 'user', ${userId}, ${'{}'}::jsonb)
        returning event_id
      `
      const [valid] = await appendEvents(database, 1)

      await expect(
        runOutboxRelayBatch(
          subject as never,
          { highWaterMark: 10, batchSize: 2 },
          relayDependencies(database, new Date(Date.now() + 1_000)),
        ),
      ).resolves.toMatchObject({ claimed: 2, published: 1, failed: 1 })

      const rows = await connection<
        { event_id: string; published_at: string | null; last_failure_category: string | null }[]
      >`
        select event_id, published_at, last_failure_category
        from domain_events order by event_sequence
      `
      expect(rows).toEqual([
        {
          event_id: invalid!.event_id,
          published_at: null,
          last_failure_category: 'invalid-event',
        },
        {
          event_id: valid!.eventId,
          published_at: expect.any(String),
          last_failure_category: null,
        },
      ])
    } finally {
      await connection.end()
    }
  })

  test('prioritizes untried events ahead of an invalid prefix retry', async () => {
    const connection = postgres(databaseUrl)
    const database = drizzle(connection, { schema })
    const subject = relayQueue(async () => undefined)
    const firstAttemptAt = new Date(Date.now() + 1_000)
    try {
      await connection`
        insert into domain_events (
          event_type, payload_version, aggregate_type, aggregate_id, payload
        ) values
          ('future.event', 1, 'user', ${userId}, ${'{}'}::jsonb),
          ('future.event', 1, 'user', ${rollbackUserId}, ${'{}'}::jsonb)
      `
      const [valid] = await appendEvents(database, 1)

      await expect(
        runOutboxRelayBatch(
          subject as never,
          { highWaterMark: 10, batchSize: 2, retryDelayMs: 1_000 },
          relayDependencies(database, firstAttemptAt),
        ),
      ).resolves.toMatchObject({ claimed: 2, published: 0, failed: 2 })
      await expect(
        runOutboxRelayBatch(
          subject as never,
          { highWaterMark: 10, batchSize: 2, retryDelayMs: 1_000 },
          relayDependencies(database, new Date(firstAttemptAt.getTime() + 1_000)),
        ),
      ).resolves.toMatchObject({ claimed: 2, published: 1, failed: 1 })

      const [storedValid] = await connection<{ published: boolean }[]>`
        select published_at is not null as published
        from domain_events where event_id = ${valid!.eventId}
      `
      expect(storedValid?.published).toBe(true)
    } finally {
      await connection.end()
    }
  })

  test('makes publication and failure updates conditional on the current claim token', async () => {
    const connection = postgres(databaseUrl)
    const database = drizzle(connection, { schema })
    try {
      await appendEvents(database, 1)
      const now = new Date(Date.now() + 1_000)
      const [claim] = await claimPendingDomainEvents(
        { limit: 1, claimTtlMs: 30_000, now },
        database,
      )
      expect(claim).toBeDefined()
      await expect(
        markDomainEventPublished(claim!.event.eventId, wrongToken, now, database),
      ).resolves.toBe(false)
      await expect(
        recordDomainEventPublishFailure(
          {
            eventId: claim!.event.eventId,
            claimToken: wrongToken,
            category: 'queue-unavailable',
            retryDelayMs: 5_000,
            now,
          },
          database,
        ),
      ).resolves.toBe(false)
      await expect(
        recordDomainEventPublishFailure(
          {
            eventId: claim!.event.eventId,
            claimToken: claim!.claimToken,
            category: 'queue-unavailable',
            retryDelayMs: 5_000,
            now,
          },
          database,
        ),
      ).resolves.toBe(true)
      await expect(
        claimPendingDomainEvents(
          { limit: 1, claimTtlMs: 30_000, now: new Date(now.getTime() + 4_999) },
          database,
        ),
      ).resolves.toEqual([])

      const [retry] = await claimPendingDomainEvents(
        { limit: 1, claimTtlMs: 30_000, now: new Date(now.getTime() + 5_000) },
        database,
      )
      await expect(
        markDomainEventPublished(claim!.event.eventId, claim!.claimToken, now, database),
      ).resolves.toBe(false)
      await expect(
        markDomainEventPublished(retry!.event.eventId, retry!.claimToken, now, database),
      ).resolves.toBe(true)
    } finally {
      await connection.end()
    }
  })

  test('retains unresolved and recent rows while deleting only old published rows', async () => {
    const connection = postgres(databaseUrl)
    const database = drizzle(connection, { schema })
    const now = new Date('2030-08-23T12:00:00.000Z')
    try {
      const events = await appendEvents(database, 3, new Date('2020-01-01T00:00:00.000Z'))
      const claims = await claimPendingDomainEvents({ limit: 2, claimTtlMs: 30_000, now }, database)
      await markDomainEventPublished(
        claims[0]!.event.eventId,
        claims[0]!.claimToken,
        new Date(now.getTime() - 31 * dayMs),
        database,
      )
      await markDomainEventPublished(
        claims[1]!.event.eventId,
        claims[1]!.claimToken,
        new Date(now.getTime() - dayMs),
        database,
      )
      await claimPendingDomainEvents({ limit: 1, claimTtlMs: 30_000, now }, database)

      await expect(
        deletePublishedDomainEvents({ retentionMs: 30 * dayMs, now }, database),
      ).resolves.toBe(1)
      const remaining = await connection<{ event_id: string; published_at: Date | null }[]>`
        select event_id, published_at from domain_events order by event_sequence
      `
      expect(remaining.map(({ event_id }) => event_id)).toEqual([
        events[1]!.eventId,
        events[2]!.eventId,
      ])
      expect(remaining[0]?.published_at).not.toBeNull()
      expect(remaining[1]?.published_at).toBeNull()
    } finally {
      await connection.end()
    }
  })

  test('reopens a bounded published selection under its original identity', async () => {
    const connection = postgres(databaseUrl)
    const database = drizzle(connection, { schema })
    const now = new Date(Date.now() + 1_000)
    try {
      const events = await appendEvents(database, 2)
      const claims = await claimPendingDomainEvents({ limit: 2, claimTtlMs: 30_000, now }, database)
      for (const claim of claims) {
        await markDomainEventPublished(claim.event.eventId, claim.claimToken, now, database)
      }
      const before = await loadDomainEvent(events[0]!.eventId, database)
      const selected = await listPublishedDomainEventIdsForRedrive(
        {
          from: new Date(now.getTime() - 1),
          to: new Date(now.getTime() + 1),
          limit: 1,
        },
        database,
      )
      const redriveAt = new Date(now.getTime() + 2)
      const redriven = await redrivePublishedDomainEvents(selected, redriveAt, database)
      expect(redriven).toEqual([events[0]!.eventId])
      await expect(loadDomainEvent(events[0]!.eventId, database)).resolves.toEqual(before)
      await expect(getPendingDomainEventAggregates(database)).resolves.toEqual({
        pendingCount: 1,
        oldestPendingAt: redriveAt,
      })

      const rows = await connection<{ event_id: string; published_at: string | null }[]>`
        select event_id, published_at from domain_events order by event_sequence
      `
      expect(rows[0]).toEqual({ event_id: events[0]!.eventId, published_at: null })
      expect(rows[1]?.event_id).toBe(events[1]!.eventId)
      expect(new Date(rows[1]!.published_at!).getTime()).toBe(now.getTime())
    } finally {
      await connection.end()
    }
  })

  test('fails an exact re-drive atomically when the inspected selection changes', async () => {
    const connection = postgres(databaseUrl)
    const database = drizzle(connection, { schema })
    const now = new Date(Date.now() + 1_000)
    try {
      await appendEvents(database, 2)
      const claims = await claimPendingDomainEvents({ limit: 2, claimTtlMs: 30_000, now }, database)
      for (const claim of claims)
        await markDomainEventPublished(claim.event.eventId, claim.claimToken, now, database)
      const selected = await listPublishedDomainEventIdsForRedrive(
        { from: new Date(now.getTime() - 1), to: new Date(now.getTime() + 1), limit: 2 },
        database,
      )
      await connection`
        update domain_events set published_at = null where event_id = ${selected[0]!}
      `

      await expect(redrivePublishedDomainEvents(selected, new Date(), database)).rejects.toThrow(
        'selection changed',
      )
      const [stillPublished] = await connection<{ count: number }[]>`
        select count(*)::integer as count
        from domain_events where event_id = ${selected[1]!} and published_at is not null
      `
      expect(stillPublished?.count).toBe(1)
    } finally {
      await connection.end()
    }
  })

  test('runs competing relay batches with one active owner per claim', async () => {
    const setup = postgres(databaseUrl)
    const first = postgres(databaseUrl)
    const second = postgres(databaseUrl)
    const inspector = postgres(databaseUrl)
    const firstDatabase = drizzle(first, { schema })
    const secondDatabase = drizzle(second, { schema })
    let releaseEnqueues: (() => void) | undefined
    const enqueuesBlocked = new Promise<void>((resolve) => (releaseEnqueues = resolve))
    const enqueued = new Set<string>()
    const claimedAt = new Date(Date.now() + 1_000)
    const queue = relayQueue(async (eventId) => {
      enqueued.add(eventId)
      await enqueuesBlocked
    })

    try {
      await appendEvents(drizzle(setup, { schema }), 4)
      const firstRun = runOutboxRelayBatch(
        queue as never,
        { highWaterMark: 10, batchSize: 2 },
        relayDependencies(firstDatabase, claimedAt),
      )
      const secondRun = runOutboxRelayBatch(
        queue as never,
        { highWaterMark: 10, batchSize: 2 },
        relayDependencies(secondDatabase, claimedAt),
      )
      await waitForCondition(() => enqueued.size === 4)

      const activeClaims = await inspector<
        { events: number; claim_tokens: number; minimum_claim_owners: number }[]
      >`
        select
          count(*)::integer as events,
          count(distinct claim_token)::integer as claim_tokens,
          min(case when claim_token is null then 0 else 1 end)::integer as minimum_claim_owners
        from domain_events
      `
      expect(activeClaims[0]).toEqual({
        events: 4,
        claim_tokens: 2,
        minimum_claim_owners: 1,
      })

      releaseEnqueues?.()
      await expect(Promise.all([firstRun, secondRun])).resolves.toEqual([
        expect.objectContaining({ claimed: 2, published: 2, failed: 0 }),
        expect.objectContaining({ claimed: 2, published: 2, failed: 0 }),
      ])
      expect(enqueued.size).toBe(4)
      const [published] = await inspector<{ published: number; claimed: number }[]>`
        select
          count(*) filter (where published_at is not null)::integer as published,
          count(*) filter (where claim_token is not null)::integer as claimed
        from domain_events
      `
      expect(published).toEqual({ published: 4, claimed: 0 })
    } finally {
      releaseEnqueues?.()
      await Promise.all([setup.end(), first.end(), second.end(), inspector.end()])
    }
  })

  test('recovers relay work abandoned by an independent service after claim expiry', async () => {
    const first = postgres(databaseUrl)
    const second = postgres(databaseUrl)
    const firstDatabase = drizzle(first, { schema })
    const secondDatabase = drizzle(second, { schema })
    const claimedAt = new Date(Date.now() + 1_000)
    const failedQueue = relayQueue(async () => {
      throw new Error('queue unavailable')
    })
    const healthyQueue = relayQueue(async () => undefined)

    try {
      await appendEvents(firstDatabase, 1)
      await expect(
        runOutboxRelayBatch(
          failedQueue as never,
          { highWaterMark: 10, batchSize: 1, claimTtlMs: 1_000 },
          {
            ...relayDependencies(firstDatabase, claimedAt),
            recordFailure: async () => {
              throw new Error('relay process stopped')
            },
          } as never,
        ),
      ).rejects.toThrow('relay process stopped')

      await expect(
        runOutboxRelayBatch(
          healthyQueue as never,
          { highWaterMark: 10, batchSize: 1, claimTtlMs: 1_000 },
          relayDependencies(secondDatabase, new Date(claimedAt.getTime() + 999)),
        ),
      ).resolves.toMatchObject({ claimed: 0 })
      await expect(
        runOutboxRelayBatch(
          healthyQueue as never,
          { highWaterMark: 10, batchSize: 1, claimTtlMs: 1_000 },
          relayDependencies(secondDatabase, new Date(claimedAt.getTime() + 1_000)),
        ),
      ).resolves.toMatchObject({ claimed: 1, published: 1 })
    } finally {
      await Promise.all([first.end(), second.end()])
    }
  })
})

const userId = '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c'
const rollbackUserId = '2b980bc2-2a90-492f-8ca6-24c6490f9a75'
const wrongToken = 'b7e7be31-3547-48aa-baaa-9b86e89e4420'
const dayMs = 24 * 60 * 60 * 1_000

function attachedEventInput(characterId = 1404328063, occurredAt?: Date) {
  return {
    type: 'character.attached' as const,
    payloadVersion: 1 as const,
    aggregateId: String(characterId),
    payload: characterSnapshot([], characterId),
    occurredAt,
  }
}

function characterSnapshot(scopes: string[], characterId = 1404328063) {
  return {
    userId,
    characterId,
    characterName: `Character ${characterId}`,
    corporationId: 1000166,
    allianceId: null,
    isMain: characterId === 1404328063,
    scopes,
  }
}

async function appendEvents(
  database: ReturnType<typeof drizzle<typeof schema>>,
  amount: number,
  occurredAt?: Date,
) {
  const events = []
  for (let index = 0; index < amount; index += 1) {
    events.push(
      await database.transaction((transaction) =>
        appendDomainEvent(transaction, attachedEventInput(1404328063 + index, occurredAt)),
      ),
    )
  }
  return events
}

function relayDependencies(database: ReturnType<typeof drizzle<typeof schema>>, now?: Date) {
  return {
    claim: (options: { limit: number; claimTtlMs: number }) =>
      claimPendingDomainEvents({ ...options, now }, database),
    acknowledge: (claimedEventId: string, token: string) =>
      markDomainEventPublished(claimedEventId, token, now ?? new Date(), database),
    recordFailure: (options: Parameters<typeof recordDomainEventPublishFailure>[0]) =>
      recordDomainEventPublishFailure({ ...options, now }, database),
  }
}

function relayQueue(enqueue: (eventId: string) => Promise<void>) {
  return {
    getJobCounts: async () => ({ waiting: 0, delayed: 0 }),
    getBackend: () => ({
      client: Promise.resolve({
        del: async () => 1,
        set: async () => 'OK',
      }),
    }),
    add: async (_name: string, payload: { eventId: string }) => {
      await enqueue(payload.eventId)
      return { id: `domain-event-${payload.eventId}` }
    },
  }
}

async function waitForCondition(condition: () => boolean) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for relay state')
}

async function waitForDatabase(url: string) {
  const connection = postgres(url)
  const deadline = Date.now() + 10_000
  try {
    while (Date.now() < deadline) {
      try {
        await connection`select 1`
        return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  } finally {
    await connection.end()
  }
  throw new Error('PostgreSQL did not become ready')
}
