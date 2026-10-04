import type { CoreDataMethodsFor, CoreDataProductId } from '@eve-space/core-data-contract'
import type {
  PlatformInventoryScope,
  PlatformPersonalInventoryCapabilities,
  PlatformCorporationInventoryCapabilities,
} from './inventory.js'
import type { PlatformPersistenceOperationReference } from './persistence.js'
import type { PlatformOrganizationContributionAuthorization } from './server.js'

export const platformGraphQLStrategies = [
  'public',
  'authenticated-session',
  'owned-character',
  'organization-member',
  'personal-inventory',
  'reviewer-corporation-inventory',
] as const

export type PlatformGraphQLStrategy = (typeof platformGraphQLStrategies)[number]

export type PlatformGraphQLInventoryCapabilities<Scope extends PlatformInventoryScope> =
  Scope extends 'personal'
    ? PlatformPersonalInventoryCapabilities
    : PlatformCorporationInventoryCapabilities

export interface PlatformGraphQLListPolicy {
  readonly argument?: string
  readonly defaultSize: number
  readonly maximum: number
}

export interface PlatformGraphQLReadDeclaration {
  readonly id: string
  readonly field: string
  readonly strategy: PlatformGraphQLStrategy
  readonly subjectArgument?: string
  readonly inventoryConsumerId?: string
  readonly requiredScope?: string
  readonly organization?: PlatformOrganizationContributionAuthorization
  readonly sectionId?: string
  readonly cost: number
  readonly sourceCost: number
  readonly list?: PlatformGraphQLListPolicy
  readonly persistenceOperations: readonly PlatformPersistenceOperationReference[]
  readonly coreDataProducts: readonly CoreDataProductId[]
}

export interface PlatformGraphQLContribution {
  readonly id: string
  readonly exportName: string
  readonly rootField: string
  readonly types: readonly string[]
  readonly reads: readonly PlatformGraphQLReadDeclaration[]
}

interface PlatformGraphQLReadCapabilitiesBase<
  ProductIds extends readonly CoreDataProductId[] = readonly [],
  Persistence extends object = object,
> {
  readonly coreData: CoreDataMethodsFor<ProductIds>
  readonly persistence: Persistence
  readonly signal: AbortSignal
  readonly cache: {
    publicUntil(expiresAt: string, maximumAgeSeconds: number): void
    noStore(): void
  }
}

export type PlatformGraphQLReadCapabilities<
  ProductIds extends readonly CoreDataProductId[] = readonly [],
  Persistence extends object = object,
  Inventory extends PlatformInventoryScope = never,
> = PlatformGraphQLReadCapabilitiesBase<ProductIds, Persistence> &
  ([Inventory] extends [never]
    ? object
    : { readonly inventory: PlatformGraphQLInventoryCapabilities<Inventory> })

export interface PlatformGraphQLReadInput<Capabilities extends object = object> {
  readonly parent: unknown
  readonly args: Readonly<Record<string, unknown>>
  readonly capabilities: Capabilities
  readonly subject: { readonly characterId: number } | null
}

export type PlatformGraphQLResolver = (input: PlatformGraphQLReadInput) => unknown

export interface PlatformGraphQLDefinition {
  readonly typeDefs: string
  readonly reads: Readonly<Record<string, PlatformGraphQLResolver>>
}

export interface PlatformInstalledGraphQLContribution extends PlatformGraphQLContribution {
  readonly moduleId: string
  readonly publisherPackage: string
  readonly definition: PlatformGraphQLDefinition
}

export const definePlatformGraphQLRead =
  <Capabilities extends object>(
    read: (input: PlatformGraphQLReadInput<Capabilities>) => unknown,
  ): PlatformGraphQLResolver =>
  (input) => {
    // SAFETY: Host composition supplies descriptor-matched capabilities; the author type grants no additional authority.
    return read({ ...input, capabilities: input.capabilities as Capabilities })
  }
