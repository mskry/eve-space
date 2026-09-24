import {
  platformCoreNavigation,
  type PlatformNuxtContributionDescriptor,
} from '@eve-space/platform-module-contract/nuxt'
import type { PlatformNavigationEntry, PlatformPageMetadata } from './runtime/navigation.js'
import { compareStable } from './stable-order.js'

export function createPlatformNavigation(
  contributions: readonly PlatformNuxtContributionDescriptor[],
) {
  const navigation: readonly PlatformNavigationEntry[] = [
    ...platformCoreNavigation.map((entry) => ({
      audience: entry.audience,
      description: entry.description,
      icon: entry.icon,
      label: entry.label,
      navigationId: entry.navigationId,
      order: entry.order,
      ownerId: entry.ownerId,
      placement: entry.placement,
      to: entry.path,
    })),
    ...contributions.flatMap((contribution) =>
      contribution.navigation.map((entry) => ({
        audience: entry.audience,
        description: entry.description,
        icon: entry.icon ?? contribution.defaultIcon,
        label: entry.label,
        navigationId: entry.id,
        order: entry.order,
        ownerId: contribution.moduleId,
        placement: entry.placement,
        sectionId: entry.sectionId,
        to: entry.to,
      })),
    ),
  ].toSorted(compareNavigation)
  const pages: readonly PlatformPageMetadata[] = contributions
    .flatMap((contribution) =>
      contribution.pages.map((page) => ({
        audience: page.audience,
        moduleId: contribution.moduleId,
        pageId: page.id,
        pageName: page.name,
        sectionId: page.sectionId,
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
