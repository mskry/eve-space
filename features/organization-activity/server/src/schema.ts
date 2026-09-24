import {
  bigint,
  index,
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
    activityId: uuid('activity_id').notNull(),
    authorizationGeneration: integer('authorization_generation').notNull(),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    resourceId: text('resource_id').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    subjectLifecycleId: uuid('subject_lifecycle_id').notNull(),
    validatedAt: timestamp('validated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('activity_snapshots_retention_idx').on(table.validatedAt),
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
    authorizationGeneration: integer('authorization_generation').notNull(),
    checkpoint: jsonb('checkpoint').notNull(),
    materializationId: uuid('materialization_id'),
    organizationVersion: bigint('organization_version', { mode: 'number' }).notNull(),
    resourceId: text('resource_id').notNull(),
    revision: bigint('revision', { mode: 'number' }).notNull().default(0),
    subjectLifecycleId: uuid('subject_lifecycle_id').notNull(),
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
