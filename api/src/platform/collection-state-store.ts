import { and, eq, sql } from 'drizzle-orm'
import type postgres from 'postgres'
import { db } from '../db/client.js'
import { platformCollectionState, type PlatformCollectionStateRow } from '../db/schema.js'
import {
  platformCollectionStateIdentitySchema,
  platformCollectionStateWriteSchema,
  type PlatformCollectionStateIdentity,
  type PlatformCollectionStateWrite,
} from './collection-state.js'

type CollectionStateReader = Pick<typeof db, 'select'>
type CollectionStateWriter = Pick<typeof db, 'insert'>

export async function loadPlatformCollectionState(
  identity: PlatformCollectionStateIdentity,
  connection: CollectionStateReader = db,
) {
  const parsed = platformCollectionStateIdentitySchema.parse(identity)
  const [stored] = await connection
    .select()
    .from(platformCollectionState)
    .where(
      and(
        eq(platformCollectionState.moduleId, parsed.moduleId),
        eq(platformCollectionState.resourceId, parsed.resourceId),
        eq(platformCollectionState.subjectKind, parsed.subjectKind),
        eq(platformCollectionState.subjectLifecycleId, parsed.subjectLifecycleId),
        eq(platformCollectionState.subjectId, parsed.subjectId),
      ),
    )
  return stored ?? null
}

export async function upsertPlatformCollectionState(
  input: PlatformCollectionStateWrite,
  connection: CollectionStateWriter = db,
) {
  const parsed = platformCollectionStateWriteSchema.parse(input)
  const [stored] = await connection
    .insert(platformCollectionState)
    .values(parsed)
    .onConflictDoUpdate({
      target: [
        platformCollectionState.moduleId,
        platformCollectionState.resourceId,
        platformCollectionState.subjectKind,
        platformCollectionState.subjectLifecycleId,
        platformCollectionState.subjectId,
      ],
      set: {
        nextEligibleAt: parsed.nextEligibleAt,
        authorizationGeneration: parsed.authorizationGeneration,
        validatedAt: parsed.validatedAt,
        lastFailureClass: parsed.lastFailureClass,
        updatedAt: sql`now()`,
      },
    })
    .returning()
  if (!stored) throw new Error('Failed to persist platform collection state')
  return stored
}

export async function upsertPlatformCollectionStateInTransaction(
  input: PlatformCollectionStateWrite,
  connection: postgres.TransactionSql,
) {
  const parsed = platformCollectionStateWriteSchema.parse(input)
  const [stored] = await connection<PlatformCollectionStateRow[]>`
    insert into platform_collection_state (
      module_id,
      resource_id,
      subject_kind,
      subject_lifecycle_id,
      subject_id,
      next_eligible_at,
      authorization_generation,
      validated_at,
      last_failure_class
    ) values (
      ${parsed.moduleId},
      ${parsed.resourceId},
      ${parsed.subjectKind},
      ${parsed.subjectLifecycleId},
      ${parsed.subjectId},
      ${parsed.nextEligibleAt},
      ${parsed.authorizationGeneration},
      ${parsed.validatedAt},
      ${parsed.lastFailureClass}
    )
    on conflict (module_id, resource_id, subject_kind, subject_lifecycle_id, subject_id)
    do update set
      next_eligible_at = excluded.next_eligible_at,
      authorization_generation = excluded.authorization_generation,
      validated_at = excluded.validated_at,
      last_failure_class = excluded.last_failure_class,
      updated_at = now()
    returning
      module_id as "moduleId",
      resource_id as "resourceId",
      subject_kind as "subjectKind",
      subject_lifecycle_id as "subjectLifecycleId",
      subject_id as "subjectId",
      next_eligible_at as "nextEligibleAt",
      authorization_generation as "authorizationGeneration",
      validated_at as "validatedAt",
      last_failure_class as "lastFailureClass",
      created_at as "createdAt",
      updated_at as "updatedAt"
  `
  if (!stored) throw new Error('Failed to persist platform collection state')
  return stored
}
