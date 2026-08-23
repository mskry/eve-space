import { UnrecoverableError } from 'bullmq'
import { z } from 'zod'
import { sql } from '../db/client.js'
import { operationsQueueName } from './namespaces.js'

type JobDurability = 'derived' | 'authoritative'
type RetryClassification = 'retryable' | 'permanent'

export interface JobDefinition<Payload> {
  name: string
  queueName: typeof operationsQueueName
  payload: z.ZodType<Payload>
  durability: JobDurability
  attempts: number
  operationIdentity(payload: Payload): string
  classifyError(error: unknown): RetryClassification
  /** `signal` aborts when a scheduler lease is lost mid-run; long operations should honour it. */
  process(payload: Payload, signal?: AbortSignal): Promise<void>
}

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

const jobRegistry = [diagnosticJob, plannerJob] as const

export function listJobDefinitions(): readonly JobDefinition<unknown>[] {
  return jobRegistry
}

export function verifyJobRegistry(
  registry: readonly Partial<JobDefinition<unknown>>[] = jobRegistry,
) {
  for (const job of registry) {
    if (job.durability !== 'derived' && job.durability !== 'authoritative')
      throw new Error(`Job ${job.name ?? 'unknown'} must declare a durability classification`)
    if (job.durability !== 'derived')
      throw new Error(`Authoritative job ${job.name ?? 'unknown'} requires an outbox-backed change`)
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

export function assertSafeJobPayload(payload: unknown) {
  const serialized = JSON.stringify(payload)
  if (
    /(?:access|refresh)[_-]?token|bearer|credential|password|session|secret|encryption/i.test(
      serialized,
    )
  )
    throw new Error('Job payload contains a sensitive value')
}
