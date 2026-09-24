import { drizzle } from 'drizzle-orm/postgres-js'
import { randomUUID } from 'node:crypto'
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
} from '../../../src/domain-events/store.js'
import { runMigrations } from '../../../src/db/migration-runner.js'
import * as schema from '../../../src/db/schema.js'
import { runOutboxRelayBatch as runSemanticOutboxRelayBatch } from '../../../src/queue/outbox-relay.js'
import type { QueueProducer } from '../../../src/queue/producer.js'

let container: StartedTestContainer
let databaseUrl: string
const databasePassword = randomUUID()

beforeAll(async () => {
  container = await new GenericContainer('postgres:17-alpine')
    .withEnvironment({
      POSTGRES_DB: 'eve_space',
      POSTGRES_PASSWORD: databasePassword,
      POSTGRES_USER: 'eve_space',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/))
    .start()
  databaseUrl = `postgres://eve_space:${databasePassword}@${container.getHost()}:${container.getMappedPort(5432)}/eve_space`
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
      expect(constraints.map(({ conname }) => conname)).toStrictEqual(
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
      expect(indexes.map(({ indexname }) => indexname)).toStrictEqual(
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
          ${connection.json(characterLifecyclePayload())}
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
      expect(committed[0]).toStrictEqual({ events: 1, users: 1 })

      await expect(
        database.transaction(async (transaction) => {
          await transaction.insert(schema.users).values({ id: rollbackUserId })
          await appendDomainEvent(transaction, {
            ...attachedEventInput(),
            aggregateId: '1404328064',
            payload: { characterId: 1_404_328_064, userId: rollbackUserId },
          })
          throw new Error('rollback probe')
        }),
      ).rejects.toThrow('rollback probe')

      const rolledBack = await connection<{ users: number; events: number }[]>`
        select
          (select count(*)::integer from users) as users,
          (select count(*)::integer from domain_events) as events
      `
      expect(rolledBack[0]).toStrictEqual({ events: 1, users: 1 })
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
      const now = new Date(Date.now() + 1000)
      const [firstClaims, secondClaims] = await Promise.all([
        claimPendingDomainEvents({ claimTtlMs: 30_000, limit: 2, now }, drizzle(first, { schema })),
        claimPendingDomainEvents(
          { claimTtlMs: 30_000, limit: 2, now },
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
      const now = new Date(Date.now() + 1000)
      const [first] = await claimPendingDomainEvents({ claimTtlMs: 1000, limit: 1, now }, database)
      expect(first?.publishAttempts).toBe(1)
      await expect(
        claimPendingDomainEvents(
          { claimTtlMs: 1000, limit: 1, now: new Date(now.getTime() + 999) },
          database,
        ),
      ).resolves.toStrictEqual([])

      const [recovered] = await claimPendingDomainEvents(
        { claimTtlMs: 1000, limit: 1, now: new Date(now.getTime() + 1000) },
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
          subject,
          { batchSize: 2, highWaterMark: 10 },
          relayStore(database, new Date(Date.now() + 1000)),
        ),
      ).resolves.toMatchObject({ claimed: 2, failed: 1, published: 1 })

      const rows = await connection<
        { event_id: string; published_at: string | null; last_failure_category: string | null }[]
      >`
        select event_id, published_at, last_failure_category
        from domain_events order by event_sequence
      `
      expect([...rows]).toStrictEqual([
        {
          event_id: invalid!.event_id,
          last_failure_category: 'invalid-event',
          published_at: null,
        },
        {
          event_id: valid!.eventId,
          last_failure_category: null,
          published_at: expect.any(String),
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
    const firstAttemptAt = new Date(Date.now() + 1000)
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
          subject,
          { batchSize: 2, highWaterMark: 10, retryDelayMs: 1000 },
          relayStore(database, firstAttemptAt),
        ),
      ).resolves.toMatchObject({ claimed: 2, failed: 2, published: 0 })
      await expect(
        runOutboxRelayBatch(
          subject,
          { batchSize: 2, highWaterMark: 10, retryDelayMs: 1000 },
          relayStore(database, new Date(firstAttemptAt.getTime() + 1000)),
        ),
      ).resolves.toMatchObject({ claimed: 2, failed: 1, published: 1 })

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
      const now = new Date(Date.now() + 1000)
      const [claim] = await claimPendingDomainEvents(
        { claimTtlMs: 30_000, limit: 1, now },
        database,
      )
      expect(claim).toBeDefined()
      await expect(
        markDomainEventPublished(claim!.event.eventId, wrongToken, now, database),
      ).resolves.toBe(false)
      await expect(
        recordDomainEventPublishFailure(
          {
            category: 'queue-unavailable',
            claimToken: wrongToken,
            eventId: claim!.event.eventId,
            now,
            retryDelayMs: 5000,
          },
          database,
        ),
      ).resolves.toBe(false)
      await expect(
        recordDomainEventPublishFailure(
          {
            category: 'queue-unavailable',
            claimToken: claim!.claimToken,
            eventId: claim!.event.eventId,
            now,
            retryDelayMs: 5000,
          },
          database,
        ),
      ).resolves.toBe(true)
      await expect(
        claimPendingDomainEvents(
          { claimTtlMs: 30_000, limit: 1, now: new Date(now.getTime() + 4999) },
          database,
        ),
      ).resolves.toStrictEqual([])

      const [retry] = await claimPendingDomainEvents(
        { claimTtlMs: 30_000, limit: 1, now: new Date(now.getTime() + 5000) },
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
      const claims = await claimPendingDomainEvents({ claimTtlMs: 30_000, limit: 2, now }, database)
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
      await claimPendingDomainEvents({ claimTtlMs: 30_000, limit: 1, now }, database)

      await expect(
        deletePublishedDomainEvents({ now, retentionMs: 30 * dayMs }, database),
      ).resolves.toBe(1)
      const remaining = await connection<{ event_id: string; published_at: Date | null }[]>`
        select event_id, published_at from domain_events order by event_sequence
      `
      expect(remaining.map(({ event_id }) => event_id)).toStrictEqual([
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
    const now = new Date(Date.now() + 1000)
    try {
      const events = await appendEvents(database, 2)
      const claims = await claimPendingDomainEvents({ claimTtlMs: 30_000, limit: 2, now }, database)
      for (const claim of claims) {
        await markDomainEventPublished(claim.event.eventId, claim.claimToken, now, database)
      }
      const before = await loadDomainEvent(events[0]!.eventId, database)
      const selected = await listPublishedDomainEventIdsForRedrive(
        {
          from: new Date(now.getTime() - 1),
          limit: 1,
          to: new Date(now.getTime() + 1),
        },
        database,
      )
      const redriveAt = new Date(now.getTime() + 2)
      const redriven = await redrivePublishedDomainEvents(selected, redriveAt, database)
      expect(redriven).toStrictEqual([events[0]!.eventId])
      await expect(loadDomainEvent(events[0]!.eventId, database)).resolves.toStrictEqual(before)
      await expect(getPendingDomainEventAggregates(database)).resolves.toStrictEqual({
        oldestPendingAt: redriveAt,
        pendingCount: 1,
      })

      const rows = await connection<{ event_id: string; published_at: string | null }[]>`
        select event_id, published_at from domain_events order by event_sequence
      `
      expect(rows[0]).toStrictEqual({ event_id: events[0]!.eventId, published_at: null })
      expect(rows[1]?.event_id).toBe(events[1]!.eventId)
      expect(new Date(rows[1]!.published_at!).getTime()).toBe(now.getTime())
    } finally {
      await connection.end()
    }
  })

  test('fails an exact re-drive atomically when the inspected selection changes', async () => {
    const connection = postgres(databaseUrl)
    const database = drizzle(connection, { schema })
    const now = new Date(Date.now() + 1000)
    try {
      await appendEvents(database, 2)
      const claims = await claimPendingDomainEvents({ claimTtlMs: 30_000, limit: 2, now }, database)
      for (const claim of claims) {
        await markDomainEventPublished(claim.event.eventId, claim.claimToken, now, database)
      }
      const selected = await listPublishedDomainEventIdsForRedrive(
        { from: new Date(now.getTime() - 1), limit: 2, to: new Date(now.getTime() + 1) },
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
    const claimedAt = new Date(Date.now() + 1000)
    const queue = relayQueue(async (eventId) => {
      enqueued.add(eventId)
      await enqueuesBlocked
    })

    try {
      await appendEvents(drizzle(setup, { schema }), 4)
      const firstRun = runOutboxRelayBatch(
        queue,
        { batchSize: 2, highWaterMark: 10 },
        relayStore(firstDatabase, claimedAt),
      )
      const secondRun = runOutboxRelayBatch(
        queue,
        { batchSize: 2, highWaterMark: 10 },
        relayStore(secondDatabase, claimedAt),
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
      expect(activeClaims[0]).toStrictEqual({
        claim_tokens: 2,
        events: 4,
        minimum_claim_owners: 1,
      })

      releaseEnqueues?.()
      await expect(Promise.all([firstRun, secondRun])).resolves.toStrictEqual([
        expect.objectContaining({ claimed: 2, failed: 0, published: 2 }),
        expect.objectContaining({ claimed: 2, failed: 0, published: 2 }),
      ])
      expect(enqueued.size).toBe(4)
      const [published] = await inspector<{ published: number; claimed: number }[]>`
        select
          count(*) filter (where published_at is not null)::integer as published,
          count(*) filter (where claim_token is not null)::integer as claimed
        from domain_events
      `
      expect(published).toStrictEqual({ claimed: 0, published: 4 })
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
    const claimedAt = new Date(Date.now() + 1000)
    const failedQueue = relayQueue(async () => {
      throw new Error('queue unavailable')
    })
    const healthyQueue = relayQueue(async () => undefined)

    try {
      await appendEvents(firstDatabase, 1)
      await expect(
        runOutboxRelayBatch(
          failedQueue,
          { batchSize: 1, claimTtlMs: 1000, highWaterMark: 10 },
          {
            ...relayStore(firstDatabase, claimedAt),
            recordFailure: async () => {
              throw new Error('relay process stopped')
            },
          },
        ),
      ).rejects.toThrow('relay process stopped')

      await expect(
        runOutboxRelayBatch(
          healthyQueue,
          { batchSize: 1, claimTtlMs: 1000, highWaterMark: 10 },
          relayStore(secondDatabase, new Date(claimedAt.getTime() + 999)),
        ),
      ).resolves.toMatchObject({ claimed: 0 })
      await expect(
        runOutboxRelayBatch(
          healthyQueue,
          { batchSize: 1, claimTtlMs: 1000, highWaterMark: 10 },
          relayStore(secondDatabase, new Date(claimedAt.getTime() + 1000)),
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
const dayMs = 24 * 60 * 60 * 1000

function attachedEventInput(characterId = 1_404_328_063, occurredAt?: Date) {
  return {
    aggregateId: String(characterId),
    occurredAt,
    payload: characterLifecyclePayload(characterId),
    payloadVersion: 1 as const,
    type: 'character.attached' as const,
  }
}

function characterLifecyclePayload(characterId = 1_404_328_063) {
  return { characterId, userId }
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
        appendDomainEvent(transaction, attachedEventInput(1_404_328_063 + index, occurredAt)),
      ),
    )
  }
  return events
}

function relayStore(database: ReturnType<typeof drizzle<typeof schema>>, now?: Date) {
  return {
    acknowledge: (claimedEventId: string, token: string) =>
      markDomainEventPublished(claimedEventId, token, now ?? new Date(), database),
    claim: (options: { limit: number; claimTtlMs: number }) =>
      claimPendingDomainEvents({ ...options, now }, database),
    recordFailure: (options: Parameters<typeof recordDomainEventPublishFailure>[0]) =>
      recordDomainEventPublishFailure({ ...options, now }, database),
  }
}

function runOutboxRelayBatch(
  producer: QueueProducer,
  options: Parameters<typeof runSemanticOutboxRelayBatch>[3],
  store: Parameters<typeof runSemanticOutboxRelayBatch>[2],
) {
  return runSemanticOutboxRelayBatch(
    producer,
    {
      recordAffiliation: async () => {},
      recordOutbox: async () => {},
    },
    store,
    options,
  )
}

function relayQueue(enqueue: (eventId: string) => Promise<void>): QueueProducer {
  return {
    async enqueue(command) {
      if (command.name !== 'domain-event') {
        throw new Error('Unexpected relay command')
      }
      await enqueue(command.payload.eventId)
      return { status: 'accepted', depth: 0 }
    },
    async enqueueMany(commands) {
      return Promise.all(commands.map((command) => this.enqueue(command)))
    },
    async inspectCapacity() {
      return { status: 'accepted', depth: 0, remainingCapacity: 1000 }
    },
    async pausePlanner() {},
    async resumePlanner() {},
  }
}

async function waitForCondition(condition: () => boolean) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (condition()) {
      return
    }
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
