import { platformCoreNavigation, type PlatformIconToken } from '@eve-space/platform-module-contract'

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
    ownerId: entry.ownerId,
    navigationId: entry.navigationId,
    label: entry.label,
    description: entry.description,
    to: entry.path,
    icon: entry.icon,
    access: entry.audience === 'authenticated' ? 'authorized' : entry.audience,
  }))

// Shell destinations may target a character-scoped route; without an authorized
// character the roster is the only resolvable destination.
export function resolveShellSectionPath(path: string, characterId: number | undefined) {
  if (!path.includes(':characterId')) return path
  return characterId === undefined
    ? '/characters'
    : path.replaceAll(':characterId', String(characterId))
}

export function visibleDashboardSections(adminAuthenticated: boolean, characterId?: number) {
  return dashboardSections
    .filter((section) => section.access !== 'admin' || adminAuthenticated)
    .map((section) => ({
      ownerId: section.ownerId,
      navigationId: section.navigationId,
      label: section.label,
      description: section.description,
      to: resolveShellSectionPath(section.to, characterId),
      icon: section.icon,
      access: section.access,
    }))
}
