import { UnrecoverableError, type Queue } from 'bullmq'
import { z } from 'zod'
import { sql } from '../db/client.js'
import { DomainEventNotFoundError } from '../domain-event-handlers.js'
import { DomainEventValidationError } from '../domain-events.js'
import { env } from '../env.js'
import { operationsQueueName } from './namespaces.js'

type RetryClassification = 'retryable' | 'permanent'

interface BaseJobDefinition<Payload> {
  name: string
  queueName: typeof operationsQueueName
  payload: z.ZodType<Payload>
  attempts: number
  operationIdentity(payload: Payload): string
  classifyError(error: unknown): RetryClassification
  /** `signal` aborts when a scheduler lease is lost mid-run; long operations should honour it. */
  process(payload: Payload, signal?: AbortSignal, context?: { queue: Queue }): Promise<void>
}

export type JobDefinition<Payload> = BaseJobDefinition<Payload> &
  (
    | { durability: 'derived'; recovery?: never }
    | { durability: 'authoritative'; recovery: 'outbox' }
  )

const diagnosticPayload = z.object({ operationId: z.literal('queue-diagnostic') }).strict()

const diagnosticJob: JobDefinition<z.infer<typeof diagnosticPayload>> = {
  name: 'diagnostic',
  queueName: operationsQueueName,
  payload: diagnosticPayload,
  durability: 'derived',
  attempts: 3,
  operationIdentity: (payload) => payload.operationId,
  classifyError: () => 'retryable',
  async process() {
    await sql`select 1`
  },
}

const plannerPayload = z.object({ operationId: z.literal('queue-planner') }).strict()

const plannerJob: JobDefinition<z.infer<typeof plannerPayload>> = {
  name: 'planner',
  queueName: operationsQueueName,
  payload: plannerPayload,
  durability: 'derived',
  attempts: 3,
  operationIdentity: (payload) => payload.operationId,
  classifyError: () => 'retryable',
  async process(_payload, signal) {
    const { enqueueDiagnostic } = await import('./platform.js')
    await enqueueDiagnostic('planner', signal)
  },
}

const domainEventPayload = z.object({ eventId: z.uuid() }).strict()

const domainEventJob: JobDefinition<z.infer<typeof domainEventPayload>> = {
  name: 'domain-event',
  queueName: operationsQueueName,
  payload: domainEventPayload,
  durability: 'authoritative',
  recovery: 'outbox',
  attempts: 5,
  operationIdentity: ({ eventId }) => domainEventJobId(eventId),
  classifyError: (error) =>
    error instanceof DomainEventValidationError || error instanceof DomainEventNotFoundError
      ? 'permanent'
      : 'retryable',
  async process({ eventId }) {
    const { dispatchDomainEvent } = await import('../domain-event-handlers.js')
    await dispatchDomainEvent(eventId)
  },
}

const outboxRelayPayload = z.object({ operationId: z.literal('outbox-relay') }).strict()

const outboxRelayJob: JobDefinition<z.infer<typeof outboxRelayPayload>> = {
  name: 'outbox-relay',
  queueName: operationsQueueName,
  payload: outboxRelayPayload,
  durability: 'derived',
  attempts: 3,
  operationIdentity: ({ operationId }) => operationId,
  classifyError: () => 'retryable',
  async process(_payload, signal, context) {
    if (!context) throw new Error('Outbox relay queue context is unavailable')
    const { runOutboxRelayBatch } = await import('./outbox-relay.js')
    await runOutboxRelayBatch(context.queue, { signal })
  },
}

const eventRetentionPayload = z
  .object({ operationId: z.literal('domain-event-retention') })
  .strict()

const eventRetentionJob: JobDefinition<z.infer<typeof eventRetentionPayload>> = {
  name: 'domain-event-retention',
  queueName: operationsQueueName,
  payload: eventRetentionPayload,
  durability: 'derived',
  attempts: 3,
  operationIdentity: ({ operationId }) => operationId,
  classifyError: () => 'retryable',
  async process(_payload, signal) {
    signal?.throwIfAborted()
    const { deletePublishedDomainEvents } = await import('../domain-event-store.js')
    await deletePublishedDomainEvents({
      retentionMs: env.DOMAIN_EVENT_PUBLISHED_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
    })
  },
}

const jobRegistry = [
  diagnosticJob,
  plannerJob,
  domainEventJob,
  outboxRelayJob,
  eventRetentionJob,
] as const

export function listJobDefinitions(): readonly JobDefinition<unknown>[] {
  return jobRegistry
}

export function verifyJobRegistry(
  registry: readonly Partial<JobDefinition<unknown>>[] = jobRegistry,
) {
  for (const job of registry) {
    if (job.durability !== 'derived' && job.durability !== 'authoritative')
      throw new Error(`Job ${job.name ?? 'unknown'} must declare a durability classification`)
    if (job.durability === 'authoritative' && job.recovery !== 'outbox')
      throw new Error(`Authoritative job ${job.name ?? 'unknown'} requires outbox recovery`)
  }
}

export function getJobDefinition(name: string) {
  return jobRegistry.find((job) => job.name === name)
}

export function validateJobPayload(job: JobDefinition<unknown>, payload: unknown) {
  const parsed = job.payload.safeParse(payload)
  if (!parsed.success) throw new UnrecoverableError(`Invalid ${job.name} job payload`)
  assertSafeJobPayload(parsed.data)
  return parsed.data
}

export function domainEventJobId(eventId: string) {
  return `domain-event-${z.uuid().parse(eventId)}`
}

export function jobOptions(definition: JobDefinition<unknown>, jobId?: string) {
  return {
    attempts: definition.attempts,
    backoff: { type: 'exponential' as const, delay: 1_000, jitter: 0.25 },
    ...(jobId ? { jobId } : {}),
    removeOnComplete: {
      age: env.QUEUE_COMPLETED_RETENTION_AGE_SECONDS,
      count: env.QUEUE_COMPLETED_RETENTION_COUNT,
    },
    removeOnFail: {
      age: env.QUEUE_FAILED_RETENTION_AGE_SECONDS,
      count: env.QUEUE_FAILED_RETENTION_COUNT,
    },
  }
}

export function assertSafeJobPayload(payload: unknown) {
  const serialized = JSON.stringify(payload)
  if (
    /(?:access|refresh)[_-]?token|bearer|credential|password|session|secret|encryption/i.test(
      serialized,
    )
  )
    throw new Error('Job payload contains a sensitive value')
}
