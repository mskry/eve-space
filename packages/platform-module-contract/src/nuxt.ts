import type {
  PlatformAuthorizationStrategy,
  PlatformModuleSectionContribution,
  PlatformOrganizationContributionAuthorization,
  PlatformRouteSecurityClassification,
  PlatformSectionBoundContribution,
} from './server.js'

export interface PlatformQueryAdmissionScopeDescriptor
  extends PlatformOrganizationContributionAuthorization, PlatformRouteSecurityClassification {
  readonly routeId: string
  readonly admissionScope: string
  readonly authorization: PlatformAuthorizationStrategy
}

export const platformNavigationAudiences = [
  'public',
  'authenticated',
  'admin',
  'owned-character',
] as const
export type PlatformNavigationAudience = (typeof platformNavigationAudiences)[number]

export const platformNavigationPlacements = ['dashboard', 'character'] as const
export type PlatformNavigationPlacement = (typeof platformNavigationPlacements)[number]

export interface PlatformNavigationDefault {
  readonly ownerId: string
  readonly navigationId: string
  readonly placement: PlatformNavigationPlacement
  readonly order: number
  readonly sectionId?: string
}

export const platformPageExtensionPoints = ['root', 'character-shell'] as const
export type PlatformPageExtensionPoint = (typeof platformPageExtensionPoints)[number]

export const platformIconTokens = [
  'overview',
  'character',
  'mail',
  'wallet',
  'corporation',
  'settings',
  'location',
  'ship',
  'auth',
  'admin',
] as const
export type PlatformIconToken = (typeof platformIconTokens)[number]

export interface PlatformCoreNavigationEntry extends PlatformNavigationDefault {
  readonly label: string
  readonly description: string
  readonly path: string
  readonly icon: PlatformIconToken
  readonly audience: PlatformNavigationAudience
}

export const platformCoreNavigation = [
  {
    ownerId: 'core',
    navigationId: 'core-overview',
    placement: 'dashboard',
    order: 10,
    label: 'Overview',
    description: 'System and identity summary',
    path: '/',
    icon: 'overview',
    audience: 'public',
  },
  {
    ownerId: 'core',
    navigationId: 'core-characters',
    placement: 'dashboard',
    order: 20,
    label: 'Characters',
    description: 'Authorized capsuleer record',
    path: '/characters',
    icon: 'character',
    audience: 'authenticated',
  },
  {
    ownerId: 'core',
    navigationId: 'core-mail',
    placement: 'dashboard',
    order: 25,
    label: 'Mail',
    description: 'Main character mailbox',
    path: '/characters/:characterId/mail',
    icon: 'mail',
    audience: 'authenticated',
  },
  {
    ownerId: 'core',
    navigationId: 'core-settings',
    placement: 'dashboard',
    order: 30,
    label: 'Settings',
    description: 'Dashboard configuration',
    path: '/settings/integrations',
    icon: 'settings',
    audience: 'public',
  },
  {
    ownerId: 'core',
    navigationId: 'core-admin',
    placement: 'dashboard',
    order: 40,
    label: 'Admin',
    description: 'Deployment ownership and access',
    path: '/admin',
    icon: 'admin',
    audience: 'admin',
  },
  {
    ownerId: 'core',
    navigationId: 'core-character-overview',
    placement: 'character',
    order: 10,
    label: 'Overview',
    description: 'Character summary',
    path: '/characters/:characterId',
    icon: 'character',
    audience: 'owned-character',
  },
  {
    ownerId: 'core',
    navigationId: 'core-character-skills',
    placement: 'character',
    order: 20,
    label: 'Skills',
    description: 'Character skills',
    path: '/characters/:characterId/skills',
    icon: 'character',
    audience: 'owned-character',
  },
  {
    ownerId: 'core',
    navigationId: 'core-character-clones',
    placement: 'character',
    order: 30,
    label: 'Clones',
    description: 'Character clones and implants',
    path: '/characters/:characterId/clones',
    icon: 'character',
    audience: 'owned-character',
  },
  {
    ownerId: 'core',
    navigationId: 'core-character-finance',
    placement: 'character',
    order: 40,
    label: 'Finance',
    description: 'Character finance',
    path: '/characters/:characterId/finance',
    icon: 'wallet',
    audience: 'owned-character',
  },
  {
    ownerId: 'core',
    navigationId: 'core-character-assets',
    placement: 'character',
    order: 50,
    label: 'Assets',
    description: 'Character assets',
    path: '/characters/:characterId/assets',
    icon: 'ship',
    audience: 'owned-character',
  },
  {
    ownerId: 'core',
    navigationId: 'core-character-history',
    placement: 'character',
    order: 60,
    label: 'History',
    description: 'Character employment history',
    path: '/characters/:characterId/history',
    icon: 'corporation',
    audience: 'owned-character',
  },
  {
    ownerId: 'core',
    navigationId: 'core-character-mail',
    placement: 'character',
    order: 70,
    label: 'Mail',
    description: 'Character mail',
    path: '/characters/:characterId/mail',
    icon: 'mail',
    audience: 'owned-character',
  },
] as const satisfies readonly PlatformCoreNavigationEntry[]

export interface PlatformPageContribution extends PlatformSectionBoundContribution {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly file: string
  readonly extensionPoint: PlatformPageExtensionPoint
  readonly audience: PlatformNavigationAudience
}

export interface PlatformNavigationContribution extends PlatformSectionBoundContribution {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly to: string
  readonly icon?: PlatformIconToken
  readonly audience: PlatformNavigationAudience
  readonly placement: PlatformNavigationPlacement
  readonly order: number
  readonly pageName: string
}

export interface PlatformNuxtContributionDescriptor {
  readonly moduleId: string
  readonly defaultIcon: PlatformIconToken
  readonly queryAdmissionScopes: readonly PlatformQueryAdmissionScopeDescriptor[]
  readonly sections: readonly PlatformModuleSectionContribution[]
  readonly pages: readonly PlatformPageContribution[]
  readonly navigation: readonly PlatformNavigationContribution[]
  readonly exposed?: PlatformNuxtExposedContributions
}

export interface PlatformInstalledNavigation extends Omit<PlatformNavigationContribution, 'icon'> {
  readonly moduleId: string
  readonly icon: PlatformIconToken
}

export interface PlatformNuxtExposedContributions {
  readonly components?: readonly string[]
  readonly composables?: readonly string[]
  readonly hooks?: readonly string[]
  readonly configurationKeys?: readonly string[]
  readonly virtualFiles?: readonly string[]
}
