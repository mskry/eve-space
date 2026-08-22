export type DashboardIcon =
  | 'overview'
  | 'character'
  | 'wallet'
  | 'corporation'
  | 'settings'
  | 'location'
  | 'ship'
  | 'auth'
  | 'admin'

export interface DashboardSection {
  label: string
  description: string
  to: string
  icon: DashboardIcon
  access: 'public' | 'authorized' | 'admin'
}

export const dashboardSections: DashboardSection[] = [
  {
    label: 'Overview',
    description: 'System and identity summary',
    to: '/',
    icon: 'overview',
    access: 'public',
  },
  {
    label: 'Characters',
    description: 'Authorized capsuleer record',
    to: '/characters',
    icon: 'character',
    access: 'authorized',
  },
  {
    label: 'Settings',
    description: 'Dashboard configuration',
    to: '/settings/integrations',
    icon: 'settings',
    access: 'public',
  },
  {
    label: 'Admin',
    description: 'Deployment ownership and access',
    to: '/admin',
    icon: 'admin',
    access: 'admin',
  },
]

export function visibleDashboardSections(adminAuthenticated: boolean) {
  return dashboardSections.filter((section) => section.access !== 'admin' || adminAuthenticated)
}
