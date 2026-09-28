import type { PlatformReviewerTargetCharacter } from '@eve-space/platform-module-contract/server'
import type { PlatformReviewerDirectoryAction } from '@eve-space/platform-module-contract/nuxt'
import type {
  PlatformReviewerPanelCatalogEntry,
  PlatformReviewerPanelProps,
} from './reviewer-panel.js'

export interface PlatformReviewerLandingAdmission {
  readonly moduleId: string
  readonly contributionId: string
  readonly routeId: string
  readonly routePath: string
  readonly sectionId?: string
  readonly target: 'managed-organization-account' | 'managed-organization-character'
  readonly placement?: 'character-landing'
  readonly directoryAction?: PlatformReviewerDirectoryAction
}

export interface PlatformReviewerLandingSection {
  readonly moduleId: string
  readonly sectionId: string
  readonly activationVersion: number
  readonly disclosureVersion: number
}

export interface PlatformCharacterLandingTarget {
  readonly userId: string
  readonly managedMemberLifecycleId: string
  readonly character: PlatformReviewerTargetCharacter
}

export interface ResolvedCharacterLandingPanel {
  readonly panel: PlatformReviewerPanelCatalogEntry
  readonly props: PlatformReviewerPanelProps
}

const sameAdmission = (
  panel: PlatformReviewerPanelCatalogEntry,
  admission: PlatformReviewerLandingAdmission,
) =>
  panel.moduleId === admission.moduleId &&
  panel.contributionId === admission.contributionId &&
  panel.routeId === admission.routeId &&
  panel.routePath === admission.routePath &&
  panel.sectionId === admission.sectionId &&
  panel.target === admission.target &&
  panel.placement === admission.placement &&
  panel.directoryAction === admission.directoryAction

const comparePanels = (
  left: PlatformReviewerPanelCatalogEntry,
  right: PlatformReviewerPanelCatalogEntry,
) =>
  left.order - right.order ||
  left.moduleId.localeCompare(right.moduleId) ||
  left.contributionId.localeCompare(right.contributionId)

export const resolveReviewerDirectoryActions = (
  available: readonly PlatformReviewerPanelCatalogEntry[],
) => {
  const ordered = available.toSorted(comparePanels)
  const review = ordered.filter((panel) => panel.directoryAction === 'review')
  return {
    reviewCharacter:
      review.find((panel) => panel.placement === 'character-landing') ??
      review.find((panel) => panel.target === 'managed-organization-character') ??
      review[0],
    manageAccount: ordered.find((panel) => panel.directoryAction === 'manage-account'),
  }
}

export const resolveCharacterLandingPanels = (input: {
  readonly installed: readonly PlatformReviewerPanelCatalogEntry[]
  readonly authorized: readonly PlatformReviewerLandingAdmission[]
  readonly enabledModuleIds: ReadonlySet<string>
  readonly enabledSections: readonly PlatformReviewerLandingSection[]
  readonly authenticated: boolean
  readonly organizationVersion: number
  readonly expectedCharacterId: number
  readonly target: PlatformCharacterLandingTarget
}): readonly ResolvedCharacterLandingPanel[] => {
  if (!input.authenticated || input.target.character.characterId !== input.expectedCharacterId) {
    return []
  }
  return input.installed
    .flatMap((panel) => {
      if (
        panel.placement !== 'character-landing' ||
        panel.target !== 'managed-organization-character' ||
        !panel.sectionId ||
        !input.enabledModuleIds.has(panel.moduleId) ||
        !input.authorized.some((admission) => sameAdmission(panel, admission))
      ) {
        return []
      }
      const section = input.enabledSections.find(
        ({ moduleId, sectionId }) => moduleId === panel.moduleId && sectionId === panel.sectionId,
      )
      if (!section) return []
      const props: PlatformReviewerPanelProps = {
        moduleId: panel.moduleId,
        contributionId: panel.contributionId,
        routeId: panel.routeId,
        sectionId: panel.sectionId,
        organizationVersion: input.organizationVersion,
        queryAccess: { authenticated: true, authorized: true, moduleEnabled: true },
        target: {
          kind: 'managed-organization-character',
          managedMemberLifecycleId: input.target.managedMemberLifecycleId,
          userId: input.target.userId,
          characterId: input.target.character.characterId,
          characterLifecycleId: input.target.character.subjectLifecycleId,
          authorizationGeneration: input.target.character.authorizationGeneration,
          disclosureVersion: section.disclosureVersion,
          sectionActivationVersion: section.activationVersion,
        },
      }
      return [{ panel, props }]
    })
    .toSorted((left, right) => comparePanels(left.panel, right.panel))
}
