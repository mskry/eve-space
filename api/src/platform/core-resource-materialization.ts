import type { PlatformResourceSubject } from '@eve-space/platform-module-contract'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  deploymentSettings,
  organizationCorporationSources,
  organizationManagedCorporations,
  platformSubjectLifecycles,
} from '../db/schema.js'
import { materializeManagedAllianceCorporations } from '../organization/managed-corporations.js'
import { materializeCorporationRoster } from '../organization/roster-collection.js'

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
    if (!organization) return false
    const result = await materializeManagedAllianceCorporations(database, {
      organizationVersion: organization.organizationVersion,
      allianceId: input.subject.allianceId,
      corporationIds: ids,
      validatedAt: input.validatedAt,
    })
    return result.outcome === 'refreshed'
  }

  if (input.resourceId === 'corporation-roster' && input.subject.kind === 'corporation') {
    if (input.authorizationGeneration === null) return false
    const [source] = await database
      .select({
        sourceId: organizationCorporationSources.sourceId,
        organizationVersion: organizationCorporationSources.organizationVersion,
        characterId: organizationCorporationSources.characterId,
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
    if (!source?.characterId) return false
    const result = await materializeCorporationRoster(database, {
      organizationVersion: source.organizationVersion,
      corporationId: input.subject.corporationId,
      sourceId: source.sourceId,
      characterId: source.characterId,
      tokenVersion: input.authorizationGeneration,
      characterIds: ids,
      validatedAt: input.validatedAt,
    })
    return result.outcome === 'refreshed'
  }

  throw new Error(`Unknown core resource ${input.resourceId}`)
}

function parseIds(value: unknown) {
  if (!Array.isArray(value)) throw new Error('Core organization resource data must be an ID array')
  const ids = value.map(Number)
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0))
    throw new Error('Core organization resource data contains an invalid ID')
  return [...new Set(ids)].toSorted((left, right) => left - right)
}
