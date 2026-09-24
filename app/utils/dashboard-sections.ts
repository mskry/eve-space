import {
  platformCoreNavigation,
  type PlatformIconToken,
} from '@eve-space/platform-module-contract/nuxt'

export type DashboardIcon = PlatformIconToken

export interface DashboardSection {
  ownerId: string
  navigationId: string
  label: string
  description: string
  to: string
  icon: DashboardIcon
  access: 'public' | 'authorized' | 'admin'
}

export const dashboardSections: DashboardSection[] = platformCoreNavigation
  .filter((entry) => entry.placement === 'dashboard')
  .map((entry) => ({
    access: entry.audience === 'authenticated' ? 'authorized' : entry.audience,
    description: entry.description,
    icon: entry.icon,
    label: entry.label,
    navigationId: entry.navigationId,
    ownerId: entry.ownerId,
    to: entry.path,
  }))

// Shell destinations may target a character-scoped route; without an authorized
// character the roster is the only resolvable destination.
export function resolveShellSectionPath(path: string, characterId: number | undefined) {
  if (!path.includes(':characterId')) {
    return path
  }
  return characterId === undefined
    ? '/characters'
    : path.replaceAll(':characterId', String(characterId))
}

export function visibleDashboardSections(adminAuthenticated: boolean, characterId?: number) {
  return dashboardSections
    .filter((section) => section.access !== 'admin' || adminAuthenticated)
    .map((section) => ({
      access: section.access,
      description: section.description,
      icon: section.icon,
      label: section.label,
      navigationId: section.navigationId,
      ownerId: section.ownerId,
      to: resolveShellSectionPath(section.to, characterId),
    }))
}
