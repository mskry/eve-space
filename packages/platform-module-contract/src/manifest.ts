import type { CoreDataProductId } from '@eve-space/core-data-contract'
import type { PlatformGraphQLContribution } from './graphql.js'
import type {
  PlatformInventoryConsumerDeclaration,
  PlatformInventoryProviderDeclaration,
} from './inventory.js'
import type { PlatformActivityProviderContribution } from './activity.js'
import type {
  PlatformPersistenceContributionReferences,
  PlatformPersistenceOperationContribution,
} from './persistence.js'
import type { PlatformResourceContribution } from './resources.js'
import type {
  PlatformPermissionDeclaration,
  PlatformPermissionProfileDeclaration,
} from './permissions.js'
import type {
  PlatformAuthorizationStrategy,
  PlatformModuleSectionContribution,
  PlatformOrganizationContributionAuthorization,
  PlatformRouteSecurityClassification,
  PlatformReviewerRouteLink,
} from './server.js'
import type {
  PlatformIconToken,
  PlatformNavigationContribution,
  PlatformNuxtExposedContributions,
  PlatformPageContribution,
  PlatformReviewerPanelDeclaration,
} from './nuxt.js'

export const platformModuleHostContractVersion = '1.2.0'

export interface PlatformModuleRelease {
  readonly publisherPackage: string
  readonly version: string
  readonly hostContractRange: string
}

export interface PlatformReviewerContribution
  extends PlatformReviewerRouteLink, PlatformReviewerPanelDeclaration {
  readonly id: string
  readonly directoryPermission?: string
}

interface PlatformRouteContributionBase extends PlatformPersistenceContributionReferences {
  readonly coreDataProducts?: readonly CoreDataProductId[]
  readonly onDemandResourceId?: string
  readonly onDemandProfileResourceId?: string
  readonly id: string
  readonly namespace: string
  readonly exportName: string
}

export type PlatformRouteContribution =
  | (PlatformRouteContributionBase & {
      readonly authorization: 'public'
      readonly audience?: never
      readonly requiredPermission?: never
      readonly additionalRequiredPermissions?: never
      readonly sectionId?: never
      readonly target?: never
      readonly exposure?: never
      readonly reviewerEvidenceResources?: never
      readonly organizationCommands?: never
    })
  | (PlatformRouteContributionBase & {
      readonly authorization: 'public-mutation'
      readonly audience?: never
      readonly requiredPermission?: never
      readonly additionalRequiredPermissions?: never
      readonly sectionId?: never
      readonly target?: never
      readonly exposure?: never
      readonly reviewerEvidenceResources?: never
      readonly organizationCommands?: never
    })
  | (PlatformRouteContributionBase & {
      readonly authorization: 'deployment-administrator'
      readonly audience?: never
      readonly requiredPermission?: never
      readonly additionalRequiredPermissions?: never
      readonly sectionId?: never
      readonly target?: never
      readonly exposure?: never
      readonly reviewerEvidenceResources?: never
      readonly organizationCommands?: never
    })
  | (PlatformRouteContributionBase &
      PlatformOrganizationContributionAuthorization &
      PlatformRouteSecurityClassification & {
        readonly authorization: Exclude<
          PlatformAuthorizationStrategy,
          'public' | 'public-mutation' | 'deployment-administrator'
        >
      })

export interface PlatformMigrationContribution {
  readonly name: string
}

export interface PlatformEsiOperationContribution {
  readonly id: string
  readonly exportName: string
}

export interface PlatformModuleManifest {
  readonly id: string
  readonly release: PlatformModuleRelease
  readonly icon: PlatformIconToken
  readonly defaultEnabled: boolean
  readonly permissions?: readonly PlatformPermissionDeclaration[]
  readonly permissionProfiles?: readonly PlatformPermissionProfileDeclaration[]
  readonly reviewerContributions?: readonly PlatformReviewerContribution[]
  readonly sections?: readonly PlatformModuleSectionContribution[]
  readonly server: {
    readonly graphql?: readonly PlatformGraphQLContribution[]
    readonly inventoryProviders?: readonly PlatformInventoryProviderDeclaration[]
    readonly inventoryConsumers?: readonly PlatformInventoryConsumerDeclaration[]
    readonly package: string
    readonly routes: readonly PlatformRouteContribution[]
    readonly migrations: readonly PlatformMigrationContribution[]
    readonly persistenceOperations: readonly PlatformPersistenceOperationContribution[]
    readonly resources: readonly PlatformResourceContribution[]
    readonly esiOperations: readonly PlatformEsiOperationContribution[]
    readonly activityProviders: readonly PlatformActivityProviderContribution[]
  }
  readonly nuxt: {
    readonly package: string
    readonly pages: readonly PlatformPageContribution[]
    readonly navigation: readonly PlatformNavigationContribution[]
    readonly exposed?: PlatformNuxtExposedContributions
  }
}

export function definePlatformModuleManifest<const Manifest extends PlatformModuleManifest>(
  manifest: Manifest,
) {
  return manifest
}
