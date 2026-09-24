import type {
  PlatformAuthorizationStrategy,
  PlatformModuleSectionContribution,
  PlatformOrganizationContributionAuthorization,
  PlatformReviewerTargetKind,
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

export interface PlatformReviewerPanelDeclaration {
  readonly panelExport: string
  readonly label: string
  readonly description: string
  readonly icon: PlatformIconToken
  readonly order: number
}

export interface PlatformReviewerNuxtContribution
  extends
    PlatformReviewerPanelDeclaration,
    PlatformSectionBoundContribution,
    PlatformOrganizationContributionAuthorization {
  readonly contributionId: string
  readonly routeId: string
  readonly routePath: string
  readonly target: PlatformReviewerTargetKind
}

export interface PlatformCoreNavigationEntry extends PlatformNavigationDefault {
  readonly label: string
  readonly description: string
  readonly path: string
  readonly icon: PlatformIconToken
  readonly audience: PlatformNavigationAudience
}

export const platformCoreNavigation = [
  {
    audience: 'public',
    description: 'System and identity summary',
    icon: 'overview',
    label: 'Overview',
    navigationId: 'core-overview',
    order: 10,
    ownerId: 'core',
    path: '/',
    placement: 'dashboard',
  },
  {
    audience: 'authenticated',
    description: 'Authorized capsuleer record',
    icon: 'character',
    label: 'Characters',
    navigationId: 'core-characters',
    order: 20,
    ownerId: 'core',
    path: '/characters',
    placement: 'dashboard',
  },
  {
    audience: 'authenticated',
    description: 'Main character mailbox',
    icon: 'mail',
    label: 'Mail',
    navigationId: 'core-mail',
    order: 25,
    ownerId: 'core',
    path: '/characters/:characterId/mail',
    placement: 'dashboard',
  },
  {
    audience: 'public',
    description: 'Dashboard configuration',
    icon: 'settings',
    label: 'Settings',
    navigationId: 'core-settings',
    order: 30,
    ownerId: 'core',
    path: '/settings/integrations',
    placement: 'dashboard',
  },
  {
    audience: 'admin',
    description: 'Deployment ownership and access',
    icon: 'admin',
    label: 'Admin',
    navigationId: 'core-admin',
    order: 40,
    ownerId: 'core',
    path: '/admin',
    placement: 'dashboard',
  },
  {
    audience: 'owned-character',
    description: 'Character summary',
    icon: 'character',
    label: 'Overview',
    navigationId: 'core-character-overview',
    order: 10,
    ownerId: 'core',
    path: '/characters/:characterId',
    placement: 'character',
  },
  {
    audience: 'owned-character',
    description: 'Character skills',
    icon: 'character',
    label: 'Skills',
    navigationId: 'core-character-skills',
    order: 20,
    ownerId: 'core',
    path: '/characters/:characterId/skills',
    placement: 'character',
  },
  {
    audience: 'owned-character',
    description: 'Character clones and implants',
    icon: 'character',
    label: 'Clones',
    navigationId: 'core-character-clones',
    order: 30,
    ownerId: 'core',
    path: '/characters/:characterId/clones',
    placement: 'character',
  },
  {
    audience: 'owned-character',
    description: 'Character finance',
    icon: 'wallet',
    label: 'Finance',
    navigationId: 'core-character-finance',
    order: 40,
    ownerId: 'core',
    path: '/characters/:characterId/finance',
    placement: 'character',
  },
  {
    audience: 'owned-character',
    description: 'Character assets',
    icon: 'ship',
    label: 'Assets',
    navigationId: 'core-character-assets',
    order: 50,
    ownerId: 'core',
    path: '/characters/:characterId/assets',
    placement: 'character',
  },
  {
    audience: 'owned-character',
    description: 'Character employment history',
    icon: 'corporation',
    label: 'History',
    navigationId: 'core-character-history',
    order: 60,
    ownerId: 'core',
    path: '/characters/:characterId/history',
    placement: 'character',
  },
  {
    audience: 'owned-character',
    description: 'Character mail',
    icon: 'mail',
    label: 'Mail',
    navigationId: 'core-character-mail',
    order: 70,
    ownerId: 'core',
    path: '/characters/:characterId/mail',
    placement: 'character',
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
  readonly packageName: string
  readonly defaultIcon: PlatformIconToken
  readonly queryAdmissionScopes: readonly PlatformQueryAdmissionScopeDescriptor[]
  readonly sections: readonly PlatformModuleSectionContribution[]
  readonly reviewerContributions: readonly PlatformReviewerNuxtContribution[]
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
