import type { PlatformPersistenceMethodsFor } from '@eve-space/platform-module-contract/persistence'
import {
  definePlatformPersistenceOperation,
  platformPersistencePayloadMaximumBytes,
} from '@eve-space/platform-module-server'
import { z } from 'zod'

const maximumSnapshots = 10_000
const maximumRequests = 10_000
const maximumRecordEntries = 10_000
const resourceIdSchema = z.string().min(1).max(100)
const cursorTokenSchema = z.string().min(1).max(4_096)
const instantSchema = z.iso.datetime({ offset: true })
const cursorSchema = z.strictObject({
  after: z.optional(cursorTokenSchema),
  before: z.optional(cursorTokenSchema),
  initialAfter: z.optional(cursorTokenSchema),
})
const activitySnapshotSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(['project', 'job', 'campaign', 'objective']),
  campaignId: z.uuid().nullable(),
  corporationId: z.number().int().positive().nullable(),
  title: z.string().max(1_000),
  description: z.string().max(100_000).nullable(),
  objective: z.string().max(10_000).nullable(),
  state: z.string().max(100),
  progress: z.strictObject({ current: z.number(), desired: z.number() }).nullable(),
  reward: z.strictObject({ initial: z.number(), remaining: z.number() }).nullable(),
  deadline: z.nullable(instantSchema),
  eligibility: z.enum(['unrestricted', 'restricted', 'unknown']),
  contributed: z.number().nullable(),
  committed: z.boolean().nullable(),
})
const boundedPathSchema = z
  .record(z.string().min(1).max(100), z.union([z.string().max(4_096), z.number().int()]))
  .refine((value) => Object.keys(value).length <= 32)
const collectionRequestSchema = z.strictObject({
  operation: z.string().min(1).max(100),
  path: boundedPathSchema,
  list: z.string().min(1).max(100).optional(),
  cursorKey: z.string().min(1).max(100).optional(),
  cursor: z.optional(cursorSchema),
  replace: z.boolean(),
  snapshot: z.optional(activitySnapshotSchema),
  validatedAt: z.optional(instantSchema),
})
const checkpointSchema = z.strictObject({
  retainedIds: z.array(z.uuid()).max(maximumSnapshots).readonly().optional(),
  retainedCampaignIds: z.array(z.uuid()).max(maximumSnapshots).readonly().optional(),
  initialized: z.boolean(),
  requests: z.array(collectionRequestSchema).max(maximumRequests).readonly(),
  cursors: z
    .record(z.string().min(1).max(100), cursorSchema)
    .refine((value) => Object.keys(value).length <= maximumRecordEntries),
})
export const readActivityCheckpointOperation = definePlatformPersistenceOperation({
  id: 'read-activity-checkpoint',
  method: 'readActivityCheckpoint',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject({
    resourceId: resourceIdSchema,
    subjectLifecycleId: z.uuid(),
    organizationVersion: z.number().int().nonnegative(),
    authorizationGeneration: z.number().int().min(-1),
  }),
  outputSchema: z
    .strictObject({
      checkpoint: checkpointSchema,
      revision: z.number().int().nonnegative(),
    })
    .nullable(),
  maximumInputBytes: 1_024,
  maximumOutputBytes: platformPersistencePayloadMaximumBytes,
})

export const readActivitySnapshotsOperation = definePlatformPersistenceOperation({
  id: 'read-activity-snapshots',
  method: 'readActivitySnapshots',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject({
    resourceId: resourceIdSchema,
    subjectLifecycleId: z.uuid(),
    organizationVersion: z.number().int().nonnegative(),
    authorizationGeneration: z.number().int().min(-1),
    activityId: z.uuid().nullable(),
  }),
  outputSchema: z.array(activitySnapshotSchema).max(100),
  maximumInputBytes: 1_024,
  maximumOutputBytes: platformPersistencePayloadMaximumBytes,
})

export const materializeActivityObservationOperation = definePlatformPersistenceOperation({
  id: 'materialize-activity-observation',
  method: 'materializeActivityObservation',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject({
    resourceId: resourceIdSchema,
    subjectLifecycleId: z.uuid(),
    organizationVersion: z.number().int().nonnegative(),
    authorizationGeneration: z.number().int().min(-1),
    materializationId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    checkpoint: checkpointSchema,
    snapshots: z
      .array(
        z.strictObject({
          snapshot: activitySnapshotSchema,
          validatedAt: instantSchema,
          replace: z.boolean(),
        }),
      )
      .max(maximumSnapshots),
  }),
  outputSchema: z.discriminatedUnion('outcome', [
    z.strictObject({ outcome: z.literal('applied'), revision: z.number().int().positive() }),
    z.strictObject({ outcome: z.literal('obsolete') }),
  ]),
  maximumInputBytes: platformPersistencePayloadMaximumBytes,
  maximumOutputBytes: 1_024,
})

export const organizationActivityPersistenceOperations = {
  'read-activity-checkpoint': readActivityCheckpointOperation,
  'read-activity-snapshots': readActivitySnapshotsOperation,
  'materialize-activity-observation': materializeActivityObservationOperation,
} as const

export type ActivityCheckpointPersistence = PlatformPersistenceMethodsFor<
  typeof organizationActivityPersistenceOperations,
  readonly ['read-activity-checkpoint']
>

export type ActivitySnapshotPersistence = PlatformPersistenceMethodsFor<
  typeof organizationActivityPersistenceOperations,
  readonly ['read-activity-snapshots']
>

export type ActivityMaterializationPersistence = PlatformPersistenceMethodsFor<
  typeof organizationActivityPersistenceOperations,
  readonly ['materialize-activity-observation']
>
