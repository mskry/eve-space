import type {
  PlatformActivityProviderCharacter,
  PlatformCollectionStatusSubject,
  PlatformInstalledResourceDescriptor,
  PlatformModuleCollectionStatusReads,
} from '@eve-space/platform-module-contract'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  organizationCorporationSources,
  organizationManagedCorporations,
  platformSubjectLifecycles,
} from '../db/schema.js'
import { getInstalledResourceCollectionStatus } from './collection-status.js'
import { findInstalledResource } from './resource-identity.js'
import { platformResources } from './resources.js'

interface ModuleCollectionStatusBinding {
  readonly moduleId: string
  readonly organizationVersion: number
  readonly characters?: readonly Pick<
    PlatformActivityProviderCharacter,
    'characterId' | 'subjectLifecycleId'
  >[]
  readonly signal?: AbortSignal
}

interface ModuleCollectionStatusOptions {
  readonly resources?: readonly PlatformInstalledResourceDescriptor[]
  readonly loadOrganizationLifecycle?: typeof loadOrganizationSubjectLifecycle
  readonly readStatus?: typeof getInstalledResourceCollectionStatus
}

export function createPlatformModuleCollectionStatusReads(
  binding: ModuleCollectionStatusBinding,
  options: ModuleCollectionStatusOptions = {},
): PlatformModuleCollectionStatusReads {
  const characters = new Map(
    (binding.characters ?? []).map(({ characterId, subjectLifecycleId }) => [
      characterId,
      subjectLifecycleId,
    ]),
  )
  const resources = options.resources ?? platformResources

  return {
    async read(resourceId, subject) {
      assertActive(binding.signal)
      assertPositiveSubjectId(subject)
      const resource = findInstalledResource(
        { moduleId: binding.moduleId, resourceId, subjectKind: subject.kind },
        resources,
      )
      if (!resource) throw new Error('Module collection resource is unavailable')

      const lifecycle =
        subject.kind === 'character'
          ? resolveCharacterLifecycle(subject, characters)
          : await (options.loadOrganizationLifecycle ?? loadOrganizationSubjectLifecycle)(
              binding.organizationVersion,
              subject,
            )
      if (!lifecycle) throw new Error('Collection subject is outside the authorized module context')

      const status = await (options.readStatus ?? getInstalledResourceCollectionStatus)(
        {
          moduleId: binding.moduleId,
          resourceId: resource.resourceId,
          subjectKind: subject.kind,
          subjectLifecycleId: lifecycle.subjectLifecycleId,
          subjectId: lifecycle.subjectId,
        },
        { resources: [resource] },
      )
      assertActive(binding.signal)
      return status
    },
  }
}

function resolveCharacterLifecycle(
  subject: Extract<PlatformCollectionStatusSubject, { kind: 'character' }>,
  characters: ReadonlyMap<number, string>,
) {
  const subjectLifecycleId = characters.get(subject.characterId)
  return subjectLifecycleId ? { subjectLifecycleId, subjectId: String(subject.characterId) } : null
}

async function loadOrganizationSubjectLifecycle(
  organizationVersion: number,
  subject: Exclude<PlatformCollectionStatusSubject, { kind: 'character' }>,
) {
  if (subject.kind === 'alliance') {
    const [lifecycle] = await db
      .select({ subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId })
      .from(platformSubjectLifecycles)
      .where(
        and(
          eq(platformSubjectLifecycles.subjectKind, 'alliance'),
          eq(platformSubjectLifecycles.subjectId, String(subject.allianceId)),
          eq(platformSubjectLifecycles.organizationDeploymentId, 1),
          eq(platformSubjectLifecycles.organizationVersion, organizationVersion),
        ),
      )
    return lifecycle ? { ...lifecycle, subjectId: String(subject.allianceId) } : null
  }

  const [lifecycle] = await db
    .select({ subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId })
    .from(platformSubjectLifecycles)
    .innerJoin(
      organizationCorporationSources,
      eq(platformSubjectLifecycles.corporationSourceId, organizationCorporationSources.sourceId),
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
      ),
    )
    .where(
      and(
        eq(platformSubjectLifecycles.subjectKind, 'corporation'),
        eq(platformSubjectLifecycles.subjectId, String(subject.corporationId)),
        eq(organizationCorporationSources.deploymentId, 1),
        eq(organizationCorporationSources.organizationVersion, organizationVersion),
        eq(organizationCorporationSources.corporationId, subject.corporationId),
        isNull(organizationCorporationSources.revokedAt),
        eq(organizationManagedCorporations.isCurrent, true),
      ),
    )
  return lifecycle ? { ...lifecycle, subjectId: String(subject.corporationId) } : null
}

function assertActive(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new Error('Module collection-status read was aborted')
}

function assertPositiveSubjectId(subject: PlatformCollectionStatusSubject) {
  const subjectId =
    subject.kind === 'character'
      ? subject.characterId
      : subject.kind === 'corporation'
        ? subject.corporationId
        : subject.allianceId
  if (!Number.isSafeInteger(subjectId) || subjectId <= 0)
    throw new Error('Module collection subject must use a positive safe integer')
}
