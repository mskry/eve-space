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
    .values({
      ...parsed,
      failureStartedAt: parsed.lastFailureClass === null ? null : new Date(),
    })
    .onConflictDoUpdate({
      set: {
        authorizationGeneration: parsed.authorizationGeneration,
        disclosureVersion: parsed.disclosureVersion ?? null,
        failureStartedAt:
          parsed.lastFailureClass === null
            ? null
            : sql`case
                when ${platformCollectionState.lastFailureClass} is null then now()
                else ${platformCollectionState.failureStartedAt}
              end`,
        lastFailureClass: parsed.lastFailureClass,
        managedMemberLifecycleId: parsed.managedMemberLifecycleId ?? null,
        nextEligibleAt: parsed.nextEligibleAt,
        organizationDeploymentId: parsed.organizationDeploymentId ?? null,
        organizationVersion: parsed.organizationVersion ?? null,
        sectionActivationVersion: parsed.sectionActivationVersion ?? null,
        sectionId: parsed.sectionId ?? null,
        targetUserId: parsed.targetUserId ?? null,
        updatedAt: sql`now()`,
        validatedAt: parsed.validatedAt,
      },
      target: [
        platformCollectionState.moduleId,
        platformCollectionState.resourceId,
        platformCollectionState.subjectKind,
        platformCollectionState.subjectLifecycleId,
        platformCollectionState.subjectId,
      ],
    })
    .returning()
  if (!stored) {
    throw new Error('Failed to persist platform collection state')
  }
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
      organization_deployment_id,
      organization_version,
      target_user_id,
      managed_member_lifecycle_id,
      section_id,
      disclosure_version,
      section_activation_version,
      validated_at,
      last_failure_class,
      failure_started_at
    ) values (
      ${parsed.moduleId},
      ${parsed.resourceId},
      ${parsed.subjectKind},
      ${parsed.subjectLifecycleId},
      ${parsed.subjectId},
      ${parsed.nextEligibleAt?.toISOString() ?? null},
      ${parsed.authorizationGeneration},
      ${parsed.organizationDeploymentId ?? null},
      ${parsed.organizationVersion ?? null},
      ${parsed.targetUserId ?? null},
      ${parsed.managedMemberLifecycleId ?? null},
      ${parsed.sectionId ?? null},
      ${parsed.disclosureVersion ?? null},
      ${parsed.sectionActivationVersion ?? null},
      ${parsed.validatedAt?.toISOString() ?? null},
      ${parsed.lastFailureClass},
      ${parsed.lastFailureClass === null ? null : new Date().toISOString()}
    )
    on conflict (module_id, resource_id, subject_kind, subject_lifecycle_id, subject_id)
    do update set
      next_eligible_at = excluded.next_eligible_at,
      authorization_generation = excluded.authorization_generation,
      organization_deployment_id = excluded.organization_deployment_id,
      organization_version = excluded.organization_version,
      target_user_id = excluded.target_user_id,
      managed_member_lifecycle_id = excluded.managed_member_lifecycle_id,
      section_id = excluded.section_id,
      disclosure_version = excluded.disclosure_version,
      section_activation_version = excluded.section_activation_version,
      validated_at = excluded.validated_at,
      last_failure_class = excluded.last_failure_class,
      failure_started_at = case
        when excluded.last_failure_class is null then null
        when platform_collection_state.last_failure_class is null then now()
        else platform_collection_state.failure_started_at
      end,
      updated_at = now()
    returning
      module_id as "moduleId",
      resource_id as "resourceId",
      subject_kind as "subjectKind",
      subject_lifecycle_id as "subjectLifecycleId",
      subject_id as "subjectId",
      next_eligible_at as "nextEligibleAt",
      authorization_generation as "authorizationGeneration",
      organization_deployment_id as "organizationDeploymentId",
      organization_version as "organizationVersion",
      target_user_id as "targetUserId",
      managed_member_lifecycle_id as "managedMemberLifecycleId",
      section_id as "sectionId",
      disclosure_version as "disclosureVersion",
      section_activation_version as "sectionActivationVersion",
      validated_at as "validatedAt",
      last_failure_class as "lastFailureClass",
      failure_started_at as "failureStartedAt",
      created_at as "createdAt",
      updated_at as "updatedAt"
  `
  if (!stored) {
    throw new Error('Failed to persist platform collection state')
  }
  return stored
}
