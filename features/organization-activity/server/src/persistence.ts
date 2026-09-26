import type { PlatformPersistenceMethodsFor } from '@eve-space/platform-module-contract/persistence'
import {
  definePlatformPersistenceOperation,
  platformPersistencePayloadMaximumBytes,
} from '@eve-space/platform-module-server'
import { z } from 'zod'
import { activityOperationIds } from './activity-protocol.js'

const maximumSnapshots = 10_000
const maximumRequests = 10_000
const maximumRecordEntries = 10_000
const resourceIdSchema = z.string().min(1).max(100)
const cursorTokenSchema = z.string().min(1).max(4096)
const instantSchema = z.iso.datetime({ offset: true })
const cursorSchema = z.strictObject({
  after: z.optional(cursorTokenSchema),
  before: z.optional(cursorTokenSchema),
  initialAfter: z.optional(cursorTokenSchema),
})
const activitySnapshotSchema = z.strictObject({
  campaignId: z.uuid().nullable(),
  committed: z.boolean().nullable(),
  contributed: z.number().nullable(),
  corporationId: z.number().int().positive().nullable(),
  deadline: z.nullable(instantSchema),
  description: z.string().max(100_000).nullable(),
  eligibility: z.enum(['unrestricted', 'restricted', 'unknown']),
  id: z.uuid(),
  kind: z.enum(['project', 'job', 'campaign', 'objective']),
  objective: z.string().max(10_000).nullable(),
  progress: z.strictObject({ current: z.number(), desired: z.number() }).nullable(),
  reward: z.strictObject({ initial: z.number(), remaining: z.number() }).nullable(),
  state: z.string().max(100),
  title: z.string().max(1000),
})
const boundedPathSchema = z
  .record(z.string().min(1).max(100), z.union([z.string().max(4096), z.number().int()]))
  .refine((value) => Object.keys(value).length <= 32)
const collectionRequestSchema = z.strictObject({
  cursor: z.optional(cursorSchema),
  cursorKey: z.string().min(1).max(100).optional(),
  list: z.string().min(1).max(100).optional(),
  operation: z.enum(activityOperationIds),
  path: boundedPathSchema,
  replace: z.boolean(),
  snapshot: z.optional(activitySnapshotSchema),
  validatedAt: z.optional(instantSchema),
})
const checkpointSchema = z.strictObject({
  authorityBinding: z
    .string()
    .regex(/^v1:[a-f\d]{64}$/)
    .optional(),
  cursors: z
    .record(z.string().min(1).max(100), cursorSchema)
    .refine((value) => Object.keys(value).length <= maximumRecordEntries),
  initialized: z.boolean(),
  requests: z.array(collectionRequestSchema).max(maximumRequests).readonly(),
  retainedCampaignIds: z.array(z.uuid()).max(maximumSnapshots).readonly().optional(),
  retainedIds: z.array(z.uuid()).max(maximumSnapshots).readonly().optional(),
})
export const readActivityCheckpointOperation = definePlatformPersistenceOperation({
  id: 'read-activity-checkpoint',
  inputSchema: z.strictObject({
    resourceId: resourceIdSchema,
    subjectLifecycleId: z.uuid(),
    organizationVersion: z.number().int().nonnegative(),
    authorizationGeneration: z.number().int().min(-1),
  }),
  maximumInputBytes: 1024,
  maximumOutputBytes: platformPersistencePayloadMaximumBytes,
  method: 'readActivityCheckpoint',
  mode: 'read',
  outputSchema: z
    .strictObject({
      checkpoint: checkpointSchema,
      revision: z.number().int().nonnegative(),
    })
    .nullable(),
  revision: 1,
})

export const readActivitySnapshotsOperation = definePlatformPersistenceOperation({
  id: 'read-activity-snapshots',
  inputSchema: z.strictObject({
    resourceId: resourceIdSchema,
    subjectLifecycleId: z.uuid(),
    organizationVersion: z.number().int().nonnegative(),
    authorizationGeneration: z.number().int().min(-1),
    activityId: z.uuid().nullable(),
  }),
  maximumInputBytes: 1024,
  maximumOutputBytes: platformPersistencePayloadMaximumBytes,
  method: 'readActivitySnapshots',
  mode: 'read',
  outputSchema: z.array(activitySnapshotSchema).max(100),
  revision: 1,
})

export const materializeActivityObservationOperation = definePlatformPersistenceOperation({
  id: 'materialize-activity-observation',
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
  maximumInputBytes: platformPersistencePayloadMaximumBytes,
  maximumOutputBytes: 1024,
  method: 'materializeActivityObservation',
  mode: 'write',
  outputSchema: z.discriminatedUnion('outcome', [
    z.strictObject({ outcome: z.literal('applied'), revision: z.number().int().positive() }),
    z.strictObject({ outcome: z.literal('obsolete') }),
  ]),
  revision: 1,
})

const organizationActivityPersistenceOperations = {
  'materialize-activity-observation': materializeActivityObservationOperation,
  'read-activity-checkpoint': readActivityCheckpointOperation,
  'read-activity-snapshots': readActivitySnapshotsOperation,
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
