import type { PlatformPermissionSensitivity } from './permissions.js'
import type { PlatformReviewerPanelDeclaration } from './nuxt.js'
import type {
  PlatformModuleSectionContribution,
  PlatformOrganizationAudience,
  PlatformOrganizationContributionAuthorization,
  PlatformReviewerServerContribution,
} from './server.js'

export interface PlatformInstalledModuleDefinition {
  readonly moduleId: string
  readonly defaultEnabled: boolean
}

export type PlatformInstalledModuleSectionDefinition = PlatformModuleSectionContribution & {
  readonly moduleId: string
}

export interface PlatformInstalledOrganizationAdmissionScopeDescriptor {
  readonly publisherPackage: string
  readonly moduleId: string
  readonly admissionScope: string
  readonly audience: 'member' | 'hr' | 'director'
  readonly requiredPermission: string
  readonly additionalRequiredPermissions?: readonly string[]
}

export interface PlatformInstalledOrganizationContributionAuthorization extends PlatformOrganizationContributionAuthorization {
  readonly publisherPackage: string
  readonly moduleId: string
}

export interface PlatformInstalledReviewerContributionDescriptor
  extends
    PlatformReviewerPanelDeclaration,
    Omit<PlatformReviewerServerContribution, 'additionalRequiredPermissions' | 'audience'> {
  readonly publisherPackage: string
  readonly moduleId: string
  readonly routePath: string
  readonly sectionId?: string
  readonly audience: Exclude<PlatformOrganizationAudience, 'member'>
  readonly panelPackage: string
}

export interface PlatformInstalledPermissionDescriptor {
  readonly publisherPackage: string
  readonly moduleId: string
  readonly key: string
  readonly label: string
  readonly purpose: string
  readonly audiences: readonly PlatformOrganizationAudience[]
  readonly sensitivity: PlatformPermissionSensitivity
  readonly reviewAllowed: boolean
}

export interface PlatformInstalledPermissionProfileDescriptor {
  readonly publisherPackage: string
  readonly moduleId: string
  readonly id: string
  readonly label: string
  readonly description: string
  readonly audiences: readonly PlatformOrganizationAudience[]
  readonly permissions: readonly string[]
}

export interface PlatformInstalledModuleMigrationDescriptor {
  readonly moduleId: string
  readonly name: string
  readonly packageName: string
  readonly exportPath: string
}

export interface PlatformInstalledPackageProvenance {
  readonly name: string
  readonly version: string
  readonly integrity: string
}

export interface PlatformInstalledModuleProvenance {
  readonly publisherPackage: string
  readonly moduleId: string
  readonly releaseVersion: string
  readonly packages: {
    readonly manifest: PlatformInstalledPackageProvenance
    readonly server: PlatformInstalledPackageProvenance
    readonly nuxt: PlatformInstalledPackageProvenance
  }
}
