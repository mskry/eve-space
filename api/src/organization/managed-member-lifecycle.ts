import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { DatabaseTransaction } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  organizationManagedCorporations,
  organizationManagedMemberLifecycles,
  platformCollectionState,
  platformSubjectLifecycles,
  users,
} from '../db/schema.js'
import { projectManagedCorporationEvidence } from './managed-corporation-evidence.js'

export async function convergeCurrentManagedMemberLifecyclesInTransaction(
  transaction: DatabaseTransaction,
  input: { readonly userIds: readonly string[]; readonly now: Date },
) {
  const userIds = [...new Set(input.userIds)].toSorted((left, right) => left.localeCompare(right))
  if (userIds.length === 0) {
    return
  }
  const [organization] = await transaction
    .select({
      organizationType: deploymentSettings.organizationType,
      organizationVersion: deploymentSettings.organizationVersion,
    })
    .from(deploymentSettings)
    .where(eq(deploymentSettings.id, 1))
    .for('key share')
  if (!organization) {
    return
  }
  await transaction
    .select({ userId: users.id })
    .from(users)
    .where(inArray(users.id, userIds))
    .orderBy(asc(users.id))
    .for('update')
  const [managedCorporations, characterRows, managedCollectionRows] = await Promise.all([
    transaction
      .select({ corporationId: organizationManagedCorporations.corporationId })
      .from(organizationManagedCorporations)
      .innerJoin(
        deploymentSettings,
        and(
          eq(deploymentSettings.id, organizationManagedCorporations.deploymentId),
          eq(
            deploymentSettings.organizationVersion,
            organizationManagedCorporations.organizationVersion,
          ),
        ),
      )
      .where(eq(organizationManagedCorporations.isCurrent, true)),
    transaction
      .select({
        affiliationCheckedAt: characters.affiliationCheckedAt,
        affiliationResolutionState: characters.affiliationResolutionState,
        corporationId: characters.corporationId,
        nextAffiliationCheck: characters.nextAffiliationCheck,
        userId: characters.userId,
      })
      .from(characters)
      .where(inArray(characters.userId, userIds))
      .orderBy(asc(characters.userId), asc(characters.characterId)),
    transaction
      .select({
        failureStartedAt: platformCollectionState.failureStartedAt,
        lastFailureClass: platformCollectionState.lastFailureClass,
        nextEligibleAt: platformCollectionState.nextEligibleAt,
        validatedAt: platformCollectionState.validatedAt,
      })
      .from(platformSubjectLifecycles)
      .innerJoin(
        deploymentSettings,
        and(
          eq(deploymentSettings.id, platformSubjectLifecycles.organizationDeploymentId),
          eq(deploymentSettings.organizationVersion, platformSubjectLifecycles.organizationVersion),
        ),
      )
      .leftJoin(
        platformCollectionState,
        and(
          eq(platformCollectionState.moduleId, 'core'),
          eq(platformCollectionState.resourceId, 'managed-corporations'),
          eq(platformCollectionState.subjectKind, 'alliance'),
          eq(
            platformCollectionState.subjectLifecycleId,
            platformSubjectLifecycles.subjectLifecycleId,
          ),
        ),
      )
      .where(eq(platformSubjectLifecycles.subjectKind, 'alliance')),
  ])
  const managedCorporationIds = new Set(
    managedCorporations.map(({ corporationId }) => corporationId),
  )
  const organizationAuthorityFresh =
    organization.organizationType === 'corporation' ||
    projectManagedCorporationEvidence(managedCollectionRows[0], input.now).freshness === 'fresh'

  for (const userId of userIds) {
    const eligible =
      organizationAuthorityFresh &&
      characterRows.some(
        (character) =>
          character.userId === userId &&
          character.affiliationResolutionState === 'resolved' &&
          character.affiliationCheckedAt !== null &&
          character.nextAffiliationCheck !== null &&
          character.nextAffiliationCheck > input.now &&
          managedCorporationIds.has(character.corporationId),
      )
    // oxlint-disable-next-line no-await-in-loop -- Stable user order serializes lifecycle transitions.
    await convergeManagedMemberLifecycleInTransaction(transaction, {
      deploymentId: 1,
      eligible,
      now: input.now,
      organizationVersion: organization.organizationVersion,
      userId,
    })
  }
}

export async function convergeManagedMemberLifecycleInTransaction(
  transaction: DatabaseTransaction,
  input: {
    readonly deploymentId: 1
    readonly organizationVersion: number
    readonly userId: string
    readonly eligible: boolean
    readonly now: Date
  },
) {
  const [active] = await transaction
    .select({
      managedMemberLifecycleId: organizationManagedMemberLifecycles.managedMemberLifecycleId,
    })
    .from(organizationManagedMemberLifecycles)
    .where(
      and(
        eq(organizationManagedMemberLifecycles.deploymentId, input.deploymentId),
        eq(organizationManagedMemberLifecycles.organizationVersion, input.organizationVersion),
        eq(organizationManagedMemberLifecycles.userId, input.userId),
        isNull(organizationManagedMemberLifecycles.endedAt),
      ),
    )
    .for('update')
  if (input.eligible) {
    if (active) {
      return active.managedMemberLifecycleId
    }
    const [created] = await transaction
      .insert(organizationManagedMemberLifecycles)
      .values({
        deploymentId: input.deploymentId,
        organizationVersion: input.organizationVersion,
        startedAt: input.now,
        updatedAt: input.now,
        userId: input.userId,
      })
      .returning({
        managedMemberLifecycleId: organizationManagedMemberLifecycles.managedMemberLifecycleId,
      })
    return created!.managedMemberLifecycleId
  }
  if (!active) {
    return null
  }
  await transaction
    .update(organizationManagedMemberLifecycles)
    .set({
      endedAt: sql`greatest(${input.now.toISOString()}::timestamptz, ${organizationManagedMemberLifecycles.startedAt})`,
      updatedAt: input.now,
    })
    .where(
      eq(
        organizationManagedMemberLifecycles.managedMemberLifecycleId,
        active.managedMemberLifecycleId,
      ),
    )
  return null
}

export async function endManagedMemberLifecyclesForOrganizationVersionInTransaction(
  transaction: DatabaseTransaction,
  input: {
    readonly deploymentId: 1
    readonly organizationVersion: number
    readonly now: Date
  },
) {
  await transaction
    .update(organizationManagedMemberLifecycles)
    .set({
      endedAt: sql`greatest(${input.now.toISOString()}::timestamptz, ${organizationManagedMemberLifecycles.startedAt})`,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(organizationManagedMemberLifecycles.deploymentId, input.deploymentId),
        eq(organizationManagedMemberLifecycles.organizationVersion, input.organizationVersion),
        isNull(organizationManagedMemberLifecycles.endedAt),
      ),
    )
}
