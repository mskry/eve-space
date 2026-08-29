import { createHash } from 'node:crypto'
import { UnrecoverableError, type Queue } from 'bullmq'
import { z } from 'zod'
import { affiliationJobPayload, processAffiliationBatch } from '../characters/affiliation-sync.js'
import { sql } from '../db/client.js'
import { DomainEventNotFoundError } from '../domain-events/handlers.js'
import { DomainEventValidationError } from '../domain-events/definitions.js'
import { env } from '../env.js'
import {
  collectionStateIdentityJson,
  platformCollectionStateIdentitySchema,
  type PlatformCollectionStateIdentity,
} from '../platform/collection-state.js'
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
  async process(_payload, signal, context) {
    signal?.throwIfAborted()
    if (!context) throw new Error('Planner queue context is unavailable')
    const { runQueuePlanner } = await import('./planner.js')
    await runQueuePlanner(context.queue, signal)
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
    const { dispatchDomainEvent } = await import('../domain-events/handlers.js')
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
    const { deletePublishedDomainEvents } = await import('../domain-events/store.js')
    await deletePublishedDomainEvents({
      retentionMs: env.DOMAIN_EVENT_PUBLISHED_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
    })
  },
}

const affiliationJob: JobDefinition<z.infer<typeof affiliationJobPayload>> = {
  name: 'affiliation',
  queueName: operationsQueueName,
  payload: affiliationJobPayload,
  durability: 'derived',
  attempts: 5,
  operationIdentity: ({ operationId }) => operationId,
  classifyError: () => 'retryable',
  async process({ characterIds }) {
    await processAffiliationBatch(characterIds)
  },
}

const resourceRefreshJob: JobDefinition<PlatformCollectionStateIdentity> = {
  name: 'resource-refresh',
  queueName: operationsQueueName,
  payload: platformCollectionStateIdentitySchema,
  durability: 'derived',
  attempts: 1,
  operationIdentity: resourceRefreshJobId,
  classifyError: () => 'permanent',
  async process(identity) {
    const { processInstalledResourceRefresh } = await import('../platform/resource-refresh.js')
    await processInstalledResourceRefresh(identity)
  },
}

export const platformResourceBatchJobPayloadSchema = z
  .object({
    moduleId: platformCollectionStateIdentitySchema.shape.moduleId,
    resourceId: platformCollectionStateIdentitySchema.shape.resourceId,
    subjectKind: z.literal('character'),
    subjects: z
      .array(
        z
          .object({
            subjectLifecycleId: platformCollectionStateIdentitySchema.shape.subjectLifecycleId,
            subjectId: platformCollectionStateIdentitySchema.shape.subjectId,
          })
          .strict(),
      )
      .min(1)
      .max(env.QUEUE_RESOURCE_PLANNER_PAGE_SIZE),
  })
  .strict()

export type PlatformResourceBatchJobPayload = z.infer<typeof platformResourceBatchJobPayloadSchema>

const resourceBatchJob: JobDefinition<PlatformResourceBatchJobPayload> = {
  name: 'resource-batch',
  queueName: operationsQueueName,
  payload: platformResourceBatchJobPayloadSchema,
  durability: 'derived',
  attempts: 1,
  operationIdentity: resourceBatchJobId,
  classifyError: () => 'permanent',
  async process(payload, _signal, context) {
    if (!context) throw new Error('Resource batch queue context is unavailable')
    const { processInstalledResourceBatch } = await import('../platform/resource-batch.js')
    await processInstalledResourceBatch(payload, context.queue)
  },
}

const jobRegistry = [
  diagnosticJob,
  plannerJob,
  domainEventJob,
  outboxRelayJob,
  eventRetentionJob,
  affiliationJob,
  resourceRefreshJob,
  resourceBatchJob,
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

export function resourceRefreshJobId(identity: PlatformCollectionStateIdentity) {
  const parsed = platformCollectionStateIdentitySchema.parse(identity)
  const digest = createHash('sha256').update(collectionStateIdentityJson(parsed)).digest('hex')
  return `resource-refresh-${digest}`
}

export function resourceBatchJobId(payload: PlatformResourceBatchJobPayload) {
  const parsed = platformResourceBatchJobPayloadSchema.parse(payload)
  const digest = createHash('sha256')
    .update(JSON.stringify([parsed.moduleId, parsed.resourceId, parsed.subjectKind]))
    .digest('hex')
  return `resource-batch-${digest}`
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
