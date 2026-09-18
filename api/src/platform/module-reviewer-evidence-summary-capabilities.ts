import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract/resources'
import type {
  PlatformReviewerCharacterEvidenceSummary,
  PlatformReviewerCollectionStatusReads,
  PlatformReviewerEvidenceSummaryReads,
  PlatformReviewerTargetContext,
} from '@eve-space/platform-module-contract/server'
import { createPlatformReviewerCollectionStatusReads } from './module-reviewer-collection-status-capabilities.js'
import { isInstalledModuleContributionEnabled } from './module-settings.js'
import { platformResources } from './resources.js'

interface ReviewerEvidenceSummaryBinding {
  readonly moduleId: string
  readonly sectionId?: string
  readonly resourceIds?: readonly string[]
  readonly target: PlatformReviewerTargetContext
}

interface ReviewerEvidenceSummaryOptions {
  readonly resources?: readonly PlatformInstalledResourceDescriptor[]
  readonly isContributionEnabled?: typeof isInstalledModuleContributionEnabled
  readonly createStatusReads?: (
    sectionId: string,
    target: PlatformReviewerTargetContext,
  ) => PlatformReviewerCollectionStatusReads
}

export function createPlatformReviewerEvidenceSummaryReads(
  binding: ReviewerEvidenceSummaryBinding,
  options: ReviewerEvidenceSummaryOptions = {},
): PlatformReviewerEvidenceSummaryReads {
  const resources = (options.resources ?? platformResources).filter(
    (resource) =>
      resource.moduleId === binding.moduleId &&
      (binding.sectionId === undefined || resource.sectionId === binding.sectionId) &&
      (binding.resourceIds === undefined || binding.resourceIds.includes(resource.resourceId)) &&
      resource.subjectKind === 'character' &&
      resource.eligibility.kind === 'current-managed-member-character' &&
      resource.sectionId !== undefined,
  )
  const resourcesBySection = groupResourcesBySection(resources)
  const targetCharacters = binding.target.characters.filter(
    ({ characterId }) =>
      binding.target.selection.kind === 'account' ||
      binding.target.selection.characterId === characterId,
  )
  const isContributionEnabled =
    options.isContributionEnabled ?? isInstalledModuleContributionEnabled
  const createStatusReads =
    options.createStatusReads ??
    ((sectionId, target) =>
      createPlatformReviewerCollectionStatusReads({
        moduleId: binding.moduleId,
        sectionId,
        resourceIds: binding.resourceIds,
        target,
      }))

  return {
    async read() {
      const enabledBySection = new Map(
        [...resourcesBySection].map(([sectionId]) => [
          sectionId,
          isContributionEnabled(binding.moduleId, sectionId),
        ]),
      )
      return (await Promise.all(
        targetCharacters.map(async ({ characterId }) => ({
          characterId,
          sections: await Promise.all(
            [...resourcesBySection].map(async ([sectionId, sectionResources]) => {
              const enabled = await enabledBySection.get(sectionId)!
              if (!enabled)
                return {
                  sectionId,
                  resources: sectionResources.map(({ resourceId }) => ({
                    resourceId,
                    status: 'unavailable' as const,
                    validatedAt: null,
                  })),
                }
              const statusReads = createStatusReads(sectionId, binding.target)
              return {
                sectionId,
                resources: await Promise.all(
                  sectionResources.map(async ({ resourceId }) => {
                    const status = await statusReads.read(resourceId, characterId)
                    return {
                      resourceId,
                      status: status.status,
                      validatedAt: status.validatedAt,
                    }
                  }),
                ),
              }
            }),
          ),
        })),
      )) satisfies readonly PlatformReviewerCharacterEvidenceSummary[]
    },
  }
}

function groupResourcesBySection(resources: readonly PlatformInstalledResourceDescriptor[]) {
  const grouped = new Map<string, PlatformInstalledResourceDescriptor[]>()
  for (const resource of resources) {
    const sectionId = resource.sectionId!
    const sectionResources = grouped.get(sectionId) ?? []
    sectionResources.push(resource)
    grouped.set(sectionId, sectionResources)
  }
  return grouped
}
