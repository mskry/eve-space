import { and, asc, eq, isNull, notExists, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  organizationCorporationRosterObservations,
  organizationCorporationSources,
  organizationManagedCorporations,
  platformCollectionState,
  platformSubjectLifecycles,
} from '../db/schema.js'
import { getInstalledResourceCollectionStatus } from '../platform/collection-status.js'

export async function listOrganizationRosterCoverage() {
  const corporations = await db
    .select({
      organizationVersion: organizationManagedCorporations.organizationVersion,
      corporationId: organizationManagedCorporations.corporationId,
      managedLastObservedAt: organizationManagedCorporations.lastObservedAt,
      sourceId: organizationCorporationSources.sourceId,
      sourceCharacterId: organizationCorporationSources.characterId,
      subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
      attemptedAt: platformCollectionState.updatedAt,
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
      corporationId: organizationCorporationRosterObservations.corporationId,
      characterId: organizationCorporationRosterObservations.characterId,
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
      organizationType: deploymentSettings.organizationType,
      organizationId: deploymentSettings.organizationId,
      organizationVersion: deploymentSettings.organizationVersion,
      subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
      configuredAt: deploymentSettings.updatedAt,
    })
    .from(deploymentSettings)
    .leftJoin(
      platformSubjectLifecycles,
      and(
        eq(platformSubjectLifecycles.organizationDeploymentId, deploymentSettings.id),
        eq(platformSubjectLifecycles.organizationVersion, deploymentSettings.organizationVersion),
      ),
    )
    .where(eq(deploymentSettings.id, 1))

  const corporationStatuses = await Promise.all(
    corporations.map(async (corporation) => {
      if (!corporation.sourceId || !corporation.subjectLifecycleId) return null
      return getInstalledResourceCollectionStatus({
        moduleId: 'core',
        resourceId: 'corporation-roster',
        subjectKind: 'corporation',
        subjectLifecycleId: corporation.subjectLifecycleId,
        subjectId: String(corporation.corporationId),
      })
    }),
  )
  const configuredManagedStatus =
    managedSet?.organizationType === 'corporation'
      ? {
          status: 'current' as const,
          validatedAt: managedSet.configuredAt.toISOString(),
          attemptedAt: managedSet.configuredAt.toISOString(),
          lastFailureClass: null,
        }
      : null
  const collectedManagedStatus =
    managedSet?.organizationType !== 'corporation' && managedSet?.subjectLifecycleId
      ? await getInstalledResourceCollectionStatus({
          moduleId: 'core',
          resourceId: 'managed-corporations',
          subjectKind: 'alliance',
          subjectLifecycleId: managedSet.subjectLifecycleId,
          subjectId: String(managedSet.organizationId),
        })
      : null
  const managedStatus = configuredManagedStatus ?? collectedManagedStatus

  return {
    managedCorporations: {
      status: managedStatus?.status ?? 'unavailable',
      validatedAt: managedStatus?.validatedAt ?? null,
      attemptedAt:
        managedStatus && 'attemptedAt' in managedStatus ? managedStatus.attemptedAt : null,
      lastFailureClass: managedStatus?.lastFailureClass ?? null,
    },
    corporations: corporations.map((corporation, index) => {
      const collection = corporationStatuses[index]
      return {
        organizationVersion: corporation.organizationVersion,
        corporationId: corporation.corporationId,
        managedLastObservedAt: corporation.managedLastObservedAt.toISOString(),
        source:
          corporation.sourceId && corporation.sourceCharacterId
            ? { sourceId: corporation.sourceId, characterId: corporation.sourceCharacterId }
            : null,
        status: projectRosterStatus(collection),
        validatedAt: collection?.validatedAt ?? null,
        attemptedAt: corporation.attemptedAt?.toISOString() ?? null,
        lastFailureClass: collection?.lastFailureClass ?? null,
        unregisteredCharacters: unregistered
          .filter(({ corporationId }) => corporationId === corporation.corporationId)
          .map(({ characterId, observedAt }) => ({
            characterId,
            observedAt: observedAt.toISOString(),
          })),
      }
    }),
  }
}

function projectRosterStatus(
  collection: Awaited<ReturnType<typeof getInstalledResourceCollectionStatus>> | null | undefined,
) {
  if (!collection) return 'never-configured' as const
  if (collection.status === 'authorization-required') return 'unauthorized' as const
  if (collection.status === 'never-collected') return 'pending' as const
  return collection.status
}
