import { and, asc, eq, gt, isNull, notExists, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  eveTokens,
  organizationCorporationRosterObservations,
  organizationCorporationSources,
  organizationManagedCorporations,
  platformCollectionState,
  platformSubjectLifecycles,
} from '../db/schema.js'
import { getInstalledResourceCollectionStatus } from '../platform/collection-status.js'
import { corporationMembershipScope } from './corporation-membership.js'
import { earliestIsoTimestamp } from './freshness.js'

const sourceCharacters = alias(characters, 'source_characters')
const sourceTokens = alias(eveTokens, 'source_tokens')

export async function listOrganizationRosterCoverage() {
  const now = new Date()
  const corporations = await db
    .select({
      attemptedAt: platformCollectionState.updatedAt,
      corporationId: organizationManagedCorporations.corporationId,
      managedLastObservedAt: organizationManagedCorporations.lastObservedAt,
      organizationVersion: organizationManagedCorporations.organizationVersion,
      sourceCharacterId: organizationCorporationSources.characterId,
      sourceId: organizationCorporationSources.sourceId,
      subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
    })
    .from(deploymentSettings)
    .innerJoin(
      organizationManagedCorporations,
      and(
        eq(organizationManagedCorporations.deploymentId, deploymentSettings.id),
        eq(
          organizationManagedCorporations.organizationVersion,
          deploymentSettings.organizationVersion,
        ),
        eq(organizationManagedCorporations.isCurrent, true),
      ),
    )
    .leftJoin(
      organizationCorporationSources,
      and(
        eq(
          organizationCorporationSources.deploymentId,
          organizationManagedCorporations.deploymentId,
        ),
        eq(
          organizationCorporationSources.organizationVersion,
          organizationManagedCorporations.organizationVersion,
        ),
        eq(
          organizationCorporationSources.corporationId,
          organizationManagedCorporations.corporationId,
        ),
        isNull(organizationCorporationSources.revokedAt),
      ),
    )
    .leftJoin(
      platformSubjectLifecycles,
      eq(platformSubjectLifecycles.corporationSourceId, organizationCorporationSources.sourceId),
    )
    .leftJoin(
      platformCollectionState,
      and(
        eq(platformCollectionState.moduleId, 'core'),
        eq(platformCollectionState.resourceId, 'corporation-roster'),
        eq(platformCollectionState.subjectKind, 'corporation'),
        eq(
          platformCollectionState.subjectLifecycleId,
          platformSubjectLifecycles.subjectLifecycleId,
        ),
      ),
    )
    .where(eq(deploymentSettings.id, 1))
    .orderBy(asc(organizationManagedCorporations.corporationId))

  const unregistered = await db
    .select({
      characterId: organizationCorporationRosterObservations.characterId,
      corporationId: organizationCorporationRosterObservations.corporationId,
      observedAt: organizationCorporationRosterObservations.observedAt,
    })
    .from(deploymentSettings)
    .innerJoin(
      organizationManagedCorporations,
      and(
        eq(organizationManagedCorporations.deploymentId, deploymentSettings.id),
        eq(
          organizationManagedCorporations.organizationVersion,
          deploymentSettings.organizationVersion,
        ),
        eq(organizationManagedCorporations.isCurrent, true),
      ),
    )
    .innerJoin(
      organizationCorporationRosterObservations,
      and(
        eq(
          organizationCorporationRosterObservations.deploymentId,
          organizationManagedCorporations.deploymentId,
        ),
        eq(
          organizationCorporationRosterObservations.organizationVersion,
          organizationManagedCorporations.organizationVersion,
        ),
        eq(
          organizationCorporationRosterObservations.corporationId,
          organizationManagedCorporations.corporationId,
        ),
      ),
    )
    .innerJoin(
      organizationCorporationSources,
      and(
        eq(
          organizationCorporationSources.sourceId,
          organizationCorporationRosterObservations.sourceId,
        ),
        eq(
          organizationCorporationSources.deploymentId,
          organizationCorporationRosterObservations.deploymentId,
        ),
        eq(
          organizationCorporationSources.organizationVersion,
          organizationCorporationRosterObservations.organizationVersion,
        ),
        eq(
          organizationCorporationSources.corporationId,
          organizationCorporationRosterObservations.corporationId,
        ),
        isNull(organizationCorporationSources.revokedAt),
      ),
    )
    .innerJoin(
      sourceCharacters,
      and(
        eq(sourceCharacters.characterId, organizationCorporationSources.characterId),
        eq(sourceCharacters.corporationId, organizationCorporationRosterObservations.corporationId),
        eq(sourceCharacters.affiliationResolutionState, 'resolved'),
        gt(sourceCharacters.nextAffiliationCheck, now),
      ),
    )
    .innerJoin(
      sourceTokens,
      and(
        eq(sourceTokens.characterId, sourceCharacters.characterId),
        eq(
          sourceTokens.tokenVersion,
          organizationCorporationRosterObservations.authorizationGeneration,
        ),
        sql`${sourceTokens.scopes} @> ${JSON.stringify([corporationMembershipScope])}::jsonb`,
      ),
    )
    .innerJoin(
      platformSubjectLifecycles,
      eq(platformSubjectLifecycles.corporationSourceId, organizationCorporationSources.sourceId),
    )
    .innerJoin(
      platformCollectionState,
      and(
        eq(platformCollectionState.moduleId, 'core'),
        eq(platformCollectionState.resourceId, 'corporation-roster'),
        eq(platformCollectionState.subjectKind, 'corporation'),
        eq(
          platformCollectionState.subjectLifecycleId,
          platformSubjectLifecycles.subjectLifecycleId,
        ),
        eq(
          platformCollectionState.authorizationGeneration,
          organizationCorporationRosterObservations.authorizationGeneration,
        ),
        eq(
          platformCollectionState.validatedAt,
          organizationCorporationRosterObservations.observedAt,
        ),
      ),
    )
    .where(
      and(
        eq(deploymentSettings.id, 1),
        notExists(
          db
            .select({ one: sql`1` })
            .from(characters)
            .where(
              eq(characters.characterId, organizationCorporationRosterObservations.characterId),
            ),
        ),
      ),
    )
    .orderBy(
      asc(organizationCorporationRosterObservations.corporationId),
      asc(organizationCorporationRosterObservations.characterId),
    )

  const [managedSet] = await db
    .select({
      configuredAt: deploymentSettings.updatedAt,
      organizationId: deploymentSettings.organizationId,
      organizationType: deploymentSettings.organizationType,
      organizationVersion: deploymentSettings.organizationVersion,
      subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
    })
    .from(deploymentSettings)
    .leftJoin(
      platformSubjectLifecycles,
      and(
        eq(platformSubjectLifecycles.subjectKind, 'alliance'),
        eq(platformSubjectLifecycles.organizationDeploymentId, deploymentSettings.id),
        eq(platformSubjectLifecycles.organizationVersion, deploymentSettings.organizationVersion),
      ),
    )
    .where(eq(deploymentSettings.id, 1))

  const corporationStatuses = await Promise.all(
    corporations.map(async (corporation) => {
      if (!corporation.sourceId || !corporation.subjectLifecycleId) {
        return null
      }
      return getInstalledResourceCollectionStatus({
        moduleId: 'core',
        resourceId: 'corporation-roster',
        subjectId: String(corporation.corporationId),
        subjectKind: 'corporation',
        subjectLifecycleId: corporation.subjectLifecycleId,
      })
    }),
  )
  const configuredManagedStatus =
    managedSet?.organizationType === 'corporation'
      ? {
          attemptedAt: managedSet.configuredAt.toISOString(),
          lastFailureClass: null,
          status: 'current' as const,
          validatedAt: managedSet.configuredAt.toISOString(),
        }
      : null
  const collectedManagedStatus =
    managedSet?.organizationType !== 'corporation' && managedSet?.subjectLifecycleId
      ? await getInstalledResourceCollectionStatus({
          moduleId: 'core',
          resourceId: 'managed-corporations',
          subjectId: String(managedSet.organizationId),
          subjectKind: 'alliance',
          subjectLifecycleId: managedSet.subjectLifecycleId,
        })
      : null
  const managedStatus = configuredManagedStatus ?? collectedManagedStatus

  const managedCorporations = {
    attemptedAt: managedStatus && 'attemptedAt' in managedStatus ? managedStatus.attemptedAt : null,
    lastFailureClass: managedStatus?.lastFailureClass ?? null,
    status: managedStatus?.status ?? 'unavailable',
    validatedAt: managedStatus?.validatedAt ?? null,
  }
  const projectedCorporations = corporations.map((corporation, index) => {
    const collection = corporationStatuses[index]
    return {
      attemptedAt: corporation.attemptedAt?.toISOString() ?? null,
      corporationId: corporation.corporationId,
      lastFailureClass: collection?.lastFailureClass ?? null,
      managedLastObservedAt: corporation.managedLastObservedAt.toISOString(),
      organizationVersion: corporation.organizationVersion,
      source:
        corporation.sourceId && corporation.sourceCharacterId
          ? { sourceId: corporation.sourceId, characterId: corporation.sourceCharacterId }
          : null,
      status: projectRosterStatus(collection),
      unregisteredCharacters: unregistered
        .filter(({ corporationId }) => corporationId === corporation.corporationId)
        .map(({ characterId, observedAt }) => ({
          characterId,
          observedAt: observedAt.toISOString(),
        })),
      validatedAt: collection?.validatedAt ?? null,
    }
  })
  return {
    corporations: projectedCorporations,
    managedCorporations,
    ...aggregateRosterFreshness([managedCorporations, ...projectedCorporations]),
  }
}

function aggregateRosterFreshness(
  collections: readonly {
    readonly status: string
    readonly validatedAt: string | null
    readonly lastFailureClass: string | null
  }[],
) {
  const staleCollections = collections.filter(({ status }) => status === 'stale')
  const validatedAt = earliestIsoTimestamp(
    staleCollections.flatMap((collection) =>
      collection.validatedAt ? [collection.validatedAt] : [],
    ),
  )
  const failureValidatedAt = earliestIsoTimestamp(
    staleCollections.flatMap((collection) =>
      collection.lastFailureClass && collection.validatedAt ? [collection.validatedAt] : [],
    ),
  )
  const refreshFailureClass =
    staleCollections.find((collection) => collection.validatedAt === failureValidatedAt)
      ?.lastFailureClass ??
    staleCollections.find(({ lastFailureClass }) => lastFailureClass)?.lastFailureClass
  return {
    stale: staleCollections.length > 0,
    ...(validatedAt && { validatedAt }),
    ...(refreshFailureClass && { refreshFailureClass }),
  }
}

function projectRosterStatus(
  collection: Awaited<ReturnType<typeof getInstalledResourceCollectionStatus>> | null | undefined,
) {
  if (!collection) {
    return 'never-configured' as const
  }
  if (collection.status === 'authorization-required') {
    return 'unauthorized' as const
  }
  if (collection.status === 'never-collected') {
    return 'pending' as const
  }
  return collection.status
}
