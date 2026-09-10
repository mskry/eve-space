import { createHash } from 'node:crypto'
import { z } from 'zod'
import { affiliationBatchLimit } from '../characters/affiliation-contract.js'
import { env } from '../env.js'
import {
  collectionStateIdentityJson,
  platformCollectionStateIdentitySchema,
  type PlatformCollectionStateIdentity,
} from '../platform/collection-state.js'
import {
  platformResourceBatchPayloadSchema,
  type PlatformResourceBatchPayload,
} from '../platform/resource-batch-contract.js'

const diagnosticJobPayload = z.object({ operationId: z.literal('queue-diagnostic') }).strict()
const plannerJobPayload = z.object({ operationId: z.literal('queue-planner') }).strict()
const domainEventJobPayload = z.object({ eventId: z.uuid() }).strict()
const outboxRelayJobPayload = z.object({ operationId: z.literal('outbox-relay') }).strict()
const domainEventRetentionJobPayload = z
  .object({ operationId: z.literal('domain-event-retention') })
  .strict()
export const affiliationJobPayload = z
  .object({
    operationId: z
      .string()
      .regex(/^affiliation-\d+(?:-\d+)*(?:--[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12})?$/i),
    characterIds: z.array(z.number().int().positive()).min(1).max(affiliationBatchLimit),
  })
  .strict()
const organizationOwnerEvidenceJobPayload = z
  .object({
    operationId: z.string().regex(/^organization-owner-evidence-[\da-f-]{36}$/i),
    grantId: z.uuid(),
  })
  .strict()
const resourceRefreshJobPayload = platformCollectionStateIdentitySchema
const resourceBatchJobPayload = platformResourceBatchPayloadSchema.safeExtend({
  subjects: platformResourceBatchPayloadSchema.shape.subjects.max(
    env.QUEUE_RESOURCE_PLANNER_PAGE_SIZE,
  ),
})

export interface JobPayloadByName {
  diagnostic: z.infer<typeof diagnosticJobPayload>
  planner: z.infer<typeof plannerJobPayload>
  'domain-event': z.infer<typeof domainEventJobPayload>
  'outbox-relay': z.infer<typeof outboxRelayJobPayload>
  'domain-event-retention': z.infer<typeof domainEventRetentionJobPayload>
  affiliation: z.infer<typeof affiliationJobPayload>
  'organization-owner-evidence': z.infer<typeof organizationOwnerEvidenceJobPayload>
  'resource-refresh': PlatformCollectionStateIdentity
  'resource-batch': PlatformResourceBatchPayload
}

export type JobName = keyof JobPayloadByName
type JobDurability =
  | { readonly kind: 'derived' }
  | { readonly kind: 'authoritative'; readonly recovery: 'outbox' }
type ActiveWorkDeduplication = 'none' | 'job-id' | 'simple' | 'planner-simple' | 'scheduler'

export interface JobContract<Name extends JobName> {
  readonly name: Name
  readonly payload: z.ZodType<JobPayloadByName[Name]>
  readonly attempts: number
  readonly durability: JobDurability
  readonly activeWorkDeduplication: ActiveWorkDeduplication
  readonly delay: 'none' | 'planner-stagger'
  readonly priority: 'none' | 'resource'
  readonly retention: {
    readonly completed: { readonly age: number; readonly count: number }
    readonly failed: { readonly age: number; readonly count: number }
  }
  operationIdentity(payload: JobPayloadByName[Name]): string
}

type JobContractCatalog = { readonly [Name in JobName]: JobContract<Name> }

const retention = {
  completed: {
    age: env.QUEUE_COMPLETED_RETENTION_AGE_SECONDS,
    count: env.QUEUE_COMPLETED_RETENTION_COUNT,
  },
  failed: {
    age: env.QUEUE_FAILED_RETENTION_AGE_SECONDS,
    count: env.QUEUE_FAILED_RETENTION_COUNT,
  },
} as const

const jobContracts = {
  diagnostic: contract({
    name: 'diagnostic',
    payload: diagnosticJobPayload,
    attempts: 3,
    durability: { kind: 'derived' },
    activeWorkDeduplication: 'planner-simple',
    delay: 'planner-stagger',
    priority: 'none',
    operationIdentity: ({ operationId }) => operationId,
  }),
  planner: contract({
    name: 'planner',
    payload: plannerJobPayload,
    attempts: 3,
    durability: { kind: 'derived' },
    activeWorkDeduplication: 'scheduler',
    delay: 'none',
    priority: 'none',
    operationIdentity: ({ operationId }) => operationId,
  }),
  'domain-event': contract({
    name: 'domain-event',
    payload: domainEventJobPayload,
    attempts: 5,
    durability: { kind: 'authoritative', recovery: 'outbox' },
    activeWorkDeduplication: 'job-id',
    delay: 'none',
    priority: 'none',
    operationIdentity: ({ eventId }) => domainEventJobId(eventId),
  }),
  'outbox-relay': contract({
    name: 'outbox-relay',
    payload: outboxRelayJobPayload,
    attempts: 3,
    durability: { kind: 'derived' },
    activeWorkDeduplication: 'scheduler',
    delay: 'none',
    priority: 'none',
    operationIdentity: ({ operationId }) => operationId,
  }),
  'domain-event-retention': contract({
    name: 'domain-event-retention',
    payload: domainEventRetentionJobPayload,
    attempts: 3,
    durability: { kind: 'derived' },
    activeWorkDeduplication: 'scheduler',
    delay: 'none',
    priority: 'none',
    operationIdentity: ({ operationId }) => operationId,
  }),
  affiliation: contract({
    name: 'affiliation',
    payload: affiliationJobPayload,
    attempts: 5,
    durability: { kind: 'derived' },
    activeWorkDeduplication: 'job-id',
    delay: 'none',
    priority: 'none',
    operationIdentity: ({ operationId }) => operationId,
  }),
  'organization-owner-evidence': contract({
    name: 'organization-owner-evidence',
    payload: organizationOwnerEvidenceJobPayload,
    attempts: 3,
    durability: { kind: 'derived' },
    activeWorkDeduplication: 'simple',
    delay: 'none',
    priority: 'none',
    operationIdentity: ({ operationId }) => operationId,
  }),
  'resource-refresh': contract({
    name: 'resource-refresh',
    payload: resourceRefreshJobPayload,
    attempts: 1,
    durability: { kind: 'derived' },
    activeWorkDeduplication: 'simple',
    delay: 'planner-stagger',
    priority: 'resource',
    operationIdentity: resourceRefreshJobId,
  }),
  'resource-batch': contract({
    name: 'resource-batch',
    payload: resourceBatchJobPayload,
    attempts: 1,
    durability: { kind: 'derived' },
    activeWorkDeduplication: 'simple',
    delay: 'planner-stagger',
    priority: 'resource',
    operationIdentity: resourceBatchJobId,
  }),
} satisfies JobContractCatalog

export function getJobContract<Name extends JobName>(name: Name): JobContractCatalog[Name] {
  return jobContracts[name]
}

export function hasJobContract(name: string): name is JobName {
  return Object.hasOwn(jobContracts, name)
}

export function listJobContracts(): readonly JobContract<JobName>[] {
  return Object.values(jobContracts)
}

export function parseJobPayload<Name extends JobName>(
  name: Name,
  payload: unknown,
): JobPayloadByName[Name] {
  const result = getJobContract(name).payload.safeParse(payload)
  if (!result.success) throw new Error(`Invalid ${name} job payload`)
  assertSafeJobPayload(result.data)
  return result.data
}

export function resolveJobContract<Name extends JobName>(name: Name, payload: unknown) {
  const resolvedContract = getJobContract(name)
  const parsed = parseJobPayload(name, payload)
  return {
    contract: resolvedContract,
    payload: parsed,
    operationIdentity: resolvedContract.operationIdentity(parsed),
  }
}

export function verifyJobContracts(contracts = listJobContracts()) {
  const names = new Set<string>()
  for (const job of contracts) {
    if (names.has(job.name)) throw new Error(`Duplicate job contract ${job.name}`)
    names.add(job.name)
    if (job.durability.kind === 'authoritative' && job.durability.recovery !== 'outbox')
      throw new Error(`Authoritative job ${job.name} requires outbox recovery`)
  }
}

export function domainEventJobId(eventId: string) {
  return `domain-event-${z.uuid().parse(eventId)}`
}

export function resourceRefreshJobId(identity: PlatformCollectionStateIdentity) {
  const parsed = platformCollectionStateIdentitySchema.parse(identity)
  const digest = createHash('sha256').update(collectionStateIdentityJson(parsed)).digest('hex')
  return `resource-refresh-${digest}`
}

export function resourceBatchJobId(payload: PlatformResourceBatchPayload) {
  const parsed = resourceBatchJobPayload.parse(payload)
  const digest = createHash('sha256')
    .update(JSON.stringify([parsed.moduleId, parsed.resourceId, parsed.subjectKind]))
    .digest('hex')
  return `resource-batch-${digest}`
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

function contract<Name extends JobName>(
  value: Omit<JobContract<Name>, 'retention'>,
): JobContract<Name> {
  return { ...value, retention }
}
