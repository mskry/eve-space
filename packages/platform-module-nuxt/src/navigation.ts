import {
  compareStable,
  platformCoreNavigation,
  type PlatformNuxtContributionDescriptor,
} from '@eve-space/platform-module-contract'
import type { PlatformNavigationEntry, PlatformPageMetadata } from './runtime/navigation.js'

export function createPlatformNavigation(
  contributions: readonly PlatformNuxtContributionDescriptor[],
) {
  const navigation: readonly PlatformNavigationEntry[] = [
    ...platformCoreNavigation.map((entry) => ({
      ownerId: entry.ownerId,
      navigationId: entry.navigationId,
      label: entry.label,
      description: entry.description,
      to: entry.path,
      icon: entry.icon,
      audience: entry.audience,
      placement: entry.placement,
      order: entry.order,
    })),
    ...contributions.flatMap((contribution) =>
      contribution.navigation.map((entry) => ({
        ownerId: contribution.moduleId,
        navigationId: entry.id,
        label: entry.label,
        description: entry.description,
        to: entry.to,
        icon: entry.icon ?? contribution.defaultIcon,
        audience: entry.audience,
        placement: entry.placement,
        order: entry.order,
      })),
    ),
  ].toSorted(compareNavigation)
  const pages: readonly PlatformPageMetadata[] = contributions
    .flatMap((contribution) =>
      contribution.pages.map((page) => ({
        moduleId: contribution.moduleId,
        pageName: page.name,
        audience: page.audience,
      })),
    )
    .toSorted(
      (left, right) =>
        compareStable(left.moduleId, right.moduleId) ||
        compareStable(left.pageName, right.pageName),
    )
  return { navigation, pages }
}

function compareNavigation(left: PlatformNavigationEntry, right: PlatformNavigationEntry) {
  return (
    compareStable(left.placement, right.placement) ||
    left.order - right.order ||
    compareStable(left.ownerId, right.ownerId) ||
    compareStable(left.navigationId, right.navigationId)
  )
}
