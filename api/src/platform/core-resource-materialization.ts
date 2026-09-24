import type { PlatformResourceSubject } from '@eve-space/platform-module-contract/resources'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  deploymentSettings,
  organizationCorporationSources,
  organizationManagedCorporations,
  platformCollectionState,
  platformSubjectLifecycles,
} from '../db/schema.js'
import { materializeManagedAllianceCorporations } from '../organization/managed-corporations.js'
import { materializeCorporationRoster } from '../organization/roster-collection.js'
import { normalizePositiveSafeIntegerIds } from './resource-id-list.js'

export async function materializeCoreResourceObservation(
  database: Pick<typeof db, 'delete' | 'insert' | 'select' | 'update'>,
  input: {
    resourceId: string
    subject: PlatformResourceSubject
    data: unknown
    validatedAt: Date
    authorizationGeneration: number | null
  },
) {
  const ids = parseIds(input.data)
  if (input.resourceId === 'managed-corporations' && input.subject.kind === 'alliance') {
    const [previousCollection] = await database
      .select({
        lastFailureClass: platformCollectionState.lastFailureClass,
        nextEligibleAt: platformCollectionState.nextEligibleAt,
        validatedAt: platformCollectionState.validatedAt,
      })
      .from(platformCollectionState)
      .where(
        and(
          eq(platformCollectionState.moduleId, 'core'),
          eq(platformCollectionState.resourceId, 'managed-corporations'),
          eq(platformCollectionState.subjectKind, 'alliance'),
          eq(platformCollectionState.subjectLifecycleId, input.subject.lifecycleId),
          eq(platformCollectionState.subjectId, String(input.subject.allianceId)),
        ),
      )
    const [organization] = await database
      .select({ organizationVersion: deploymentSettings.organizationVersion })
      .from(deploymentSettings)
      .innerJoin(
        platformSubjectLifecycles,
        and(
          eq(platformSubjectLifecycles.subjectLifecycleId, input.subject.lifecycleId),
          eq(platformSubjectLifecycles.subjectKind, 'alliance'),
          eq(platformSubjectLifecycles.subjectId, String(input.subject.allianceId)),
          eq(platformSubjectLifecycles.organizationDeploymentId, deploymentSettings.id),
          eq(platformSubjectLifecycles.organizationVersion, deploymentSettings.organizationVersion),
        ),
      )
      .where(
        and(
          eq(deploymentSettings.id, 1),
          eq(deploymentSettings.organizationType, 'alliance'),
          eq(deploymentSettings.organizationId, input.subject.allianceId),
        ),
      )
    if (!organization) {
      return null
    }
    const result = await materializeManagedAllianceCorporations(database, {
      allianceId: input.subject.allianceId,
      corporationIds: ids,
      organizationVersion: organization.organizationVersion,
      validatedAt: input.validatedAt,
    })
    return result.outcome === 'refreshed'
      ? {
          affectedCorporationIds: [...result.addedIds, ...result.removedIds],
          organizationVersion: organization.organizationVersion,
          recomputeAllAccounts:
            !previousCollection?.validatedAt ||
            previousCollection.lastFailureClass !== null ||
            !previousCollection.nextEligibleAt ||
            previousCollection.nextEligibleAt <= input.validatedAt,
        }
      : null
  }

  if (input.resourceId === 'corporation-roster' && input.subject.kind === 'corporation') {
    if (input.authorizationGeneration === null) {
      return null
    }
    const [source] = await database
      .select({
        characterId: organizationCorporationSources.characterId,
        organizationVersion: organizationCorporationSources.organizationVersion,
        sourceId: organizationCorporationSources.sourceId,
      })
      .from(platformSubjectLifecycles)
      .innerJoin(
        organizationCorporationSources,
        eq(organizationCorporationSources.sourceId, platformSubjectLifecycles.corporationSourceId),
      )
      .innerJoin(
        deploymentSettings,
        and(
          eq(deploymentSettings.id, organizationCorporationSources.deploymentId),
          eq(
            deploymentSettings.organizationVersion,
            organizationCorporationSources.organizationVersion,
          ),
        ),
      )
      .innerJoin(
        organizationManagedCorporations,
        and(
          eq(
            organizationManagedCorporations.deploymentId,
            organizationCorporationSources.deploymentId,
          ),
          eq(
            organizationManagedCorporations.organizationVersion,
            organizationCorporationSources.organizationVersion,
          ),
          eq(
            organizationManagedCorporations.corporationId,
            organizationCorporationSources.corporationId,
          ),
          eq(organizationManagedCorporations.isCurrent, true),
        ),
      )
      .where(
        and(
          eq(platformSubjectLifecycles.subjectLifecycleId, input.subject.lifecycleId),
          eq(platformSubjectLifecycles.subjectKind, 'corporation'),
          eq(platformSubjectLifecycles.subjectId, String(input.subject.corporationId)),
          eq(organizationCorporationSources.corporationId, input.subject.corporationId),
        ),
      )
    if (!source?.characterId) {
      return null
    }
    const result = await materializeCorporationRoster(database, {
      characterId: source.characterId,
      characterIds: ids,
      corporationId: input.subject.corporationId,
      organizationVersion: source.organizationVersion,
      sourceId: source.sourceId,
      tokenVersion: input.authorizationGeneration,
      validatedAt: input.validatedAt,
    })
    return result.outcome === 'refreshed'
      ? {
          affectedCorporationIds: [],
          organizationVersion: source.organizationVersion,
          recomputeAllAccounts: false,
        }
      : null
  }

  throw new Error(`Unknown core resource ${input.resourceId}`)
}

function parseIds(value: unknown) {
  if (!Array.isArray(value)) {
    throw new TypeError('Core organization resource data must be an ID array')
  }
  return normalizePositiveSafeIntegerIds(value, 'Core organization resource data')
}
