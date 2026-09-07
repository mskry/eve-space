import {
  bigint,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

export const activitySnapshots = pgTable(
  'activity_snapshots',
  {
    resourceId: text('resource_id').notNull(),
    subjectLifecycleId: uuid('subject_lifecycle_id').notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    authorizationGeneration: integer('authorization_generation').notNull(),
    activityId: uuid('activity_id').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    validatedAt: timestamp('validated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.resourceId,
        table.subjectLifecycleId,
        table.organizationVersion,
        table.authorizationGeneration,
        table.activityId,
      ],
    }),
  ],
)

export const collectionCheckpoints = pgTable(
  'collection_checkpoints',
  {
    resourceId: text('resource_id').notNull(),
    subjectLifecycleId: uuid('subject_lifecycle_id').notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    authorizationGeneration: integer('authorization_generation').notNull(),
    checkpoint: jsonb('checkpoint').notNull(),
    revision: bigint('revision', { mode: 'number' }).notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [
        table.resourceId,
        table.subjectLifecycleId,
        table.organizationVersion,
        table.authorizationGeneration,
      ],
    }),
  ],
)
