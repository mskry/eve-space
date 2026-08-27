import { platformCoreNavigation, type PlatformIconToken } from '@eve-space/platform-module-contract'

export type DashboardIcon = PlatformIconToken

export interface DashboardSection {
  label: string
  description: string
  to: string
  icon: DashboardIcon
  access: 'public' | 'authorized' | 'admin'
}

export const dashboardSections: DashboardSection[] = platformCoreNavigation
  .filter((entry) => entry.placement === 'dashboard')
  .map((entry) => ({
    label: entry.label,
    description: entry.description,
    to: entry.path,
    icon: entry.icon,
    access: entry.audience === 'authenticated' ? 'authorized' : entry.audience,
  }))

export function visibleDashboardSections(adminAuthenticated: boolean) {
  return dashboardSections.filter((section) => section.access !== 'admin' || adminAuthenticated)
}
