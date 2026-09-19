import type { PlatformInstalledReviewerContributionDescriptor } from '@eve-space/platform-module-contract/installed'
import { installedReviewerContributions } from '../generated/platform/installed-reviewer-contributions.js'
import { loadModuleRuntimeState } from './module-settings.js'
import type { ModuleRuntimeState } from './module-runtime-cache.js'

export function requireInstalledReviewerContribution(
  descriptor: PlatformInstalledReviewerContributionDescriptor,
  catalog: readonly PlatformInstalledReviewerContributionDescriptor[] = installedReviewerContributions,
) {
  const installed = catalog.find(
    (candidate) =>
      candidate.publisherPackage === descriptor.publisherPackage &&
      candidate.moduleId === descriptor.moduleId &&
      candidate.contributionId === descriptor.contributionId,
  )
  if (!installed || !sameReviewerContribution(installed, descriptor))
    throw new Error('Reviewer contribution descriptor is not installed')
  return installed
}

export async function listAvailableReviewerContributions(
  catalog: readonly PlatformInstalledReviewerContributionDescriptor[] = installedReviewerContributions,
  loadRuntimeState: () => Promise<ModuleRuntimeState> = loadModuleRuntimeState,
) {
  if (catalog.length === 0) return []
  const state = await loadRuntimeState()
  return catalog.filter((descriptor) => reviewerContributionEnabled(descriptor, state))
}

function reviewerContributionEnabled(
  descriptor: PlatformInstalledReviewerContributionDescriptor,
  state: ModuleRuntimeState,
) {
  if (!state.enabledModuleIds.includes(descriptor.moduleId)) return false
  if (!descriptor.sectionId) return true
  return state.enabledSections.some(
    (section) =>
      section.moduleId === descriptor.moduleId && section.sectionId === descriptor.sectionId,
  )
}

function sameReviewerContribution(
  left: PlatformInstalledReviewerContributionDescriptor,
  right: PlatformInstalledReviewerContributionDescriptor,
) {
  return (
    left.publisherPackage === right.publisherPackage &&
    left.moduleId === right.moduleId &&
    left.contributionId === right.contributionId &&
    left.routeId === right.routeId &&
    left.routePath === right.routePath &&
    left.sectionId === right.sectionId &&
    left.audience === right.audience &&
    left.requiredPermission === right.requiredPermission &&
    left.target === right.target &&
    left.panelPackage === right.panelPackage &&
    left.panelExport === right.panelExport &&
    left.label === right.label &&
    left.description === right.description &&
    left.icon === right.icon &&
    left.order === right.order
  )
}
