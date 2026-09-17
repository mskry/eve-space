import type { CoreDataProductId } from '@eve-space/core-data-contract'
import type { PlatformActivityProviderContribution } from './activity.js'
import type {
  PlatformPersistenceContributionReferences,
  PlatformPersistenceOperationContribution,
} from './persistence.js'
import type { PlatformResourceContribution } from './resources.js'
import type {
  PlatformAuthorizationStrategy,
  PlatformModuleSectionContribution,
  PlatformOrganizationContributionAuthorization,
  PlatformRouteSecurityClassification,
} from './server.js'
import type {
  PlatformIconToken,
  PlatformNavigationContribution,
  PlatformNuxtExposedContributions,
  PlatformPageContribution,
} from './nuxt.js'

export interface PlatformRouteContribution
  extends
    PlatformOrganizationContributionAuthorization,
    PlatformPersistenceContributionReferences,
    PlatformRouteSecurityClassification {
  readonly coreDataProducts?: readonly CoreDataProductId[]
  readonly id: string
  readonly namespace: string
  readonly exportName: string
  readonly authorization: PlatformAuthorizationStrategy
}

export interface PlatformMigrationContribution {
  readonly name: string
}

export interface PlatformEsiOperationContribution {
  readonly id: string
  readonly exportName: string
}

export interface PlatformModuleManifest {
  readonly id: string
  readonly icon: PlatformIconToken
  readonly defaultEnabled: boolean
  readonly sections?: readonly PlatformModuleSectionContribution[]
  readonly server: {
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
