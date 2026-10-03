import type { PlatformPersistenceOperationReference } from './persistence.js'

export const platformInventoryContractVersion = 1
export const platformInventoryBounds = Object.freeze({
  personalSubjects: 20,
  corporationSubjects: 250,
  pageSize: 100,
  personalRecordsPerSubject: 10_000,
  personalSourcePages: 20,
})

declare const admittedInventoryBrand: unique symbol

export type PlatformInventoryQuantity = `${bigint}`
export type PlatformInventoryScope = 'personal' | 'corporation'
export type PlatformInventoryCoverageState =
  | 'included-current'
  | 'included-stale'
  | 'authorization-required'
  | 'never-collected'
  | 'unavailable'
  | 'incomplete'
  | 'beyond-retention'
  | 'conflicting-source'
export type PlatformInventoryBlueprint = 'none' | 'original' | 'copy'
export type PlatformInventoryLocationState = 'resolved' | 'unknown' | 'restricted' | 'unresolved'

export const emptyInventoryCoverageCounts = (): Record<PlatformInventoryCoverageState, number> => ({
  'included-current': 0,
  'included-stale': 0,
  'authorization-required': 0,
  'never-collected': 0,
  unavailable: 0,
  incomplete: 0,
  'beyond-retention': 0,
  'conflicting-source': 0,
})

export interface PlatformInventoryLocation {
  readonly key: string
  readonly id: string | null
  readonly name: string | null
  readonly state: PlatformInventoryLocationState
}

export interface PlatformInventoryGroup {
  readonly key: string
  readonly typeId: number
  readonly typeName: string | null
  readonly groupId: number | null
  readonly categoryId: number | null
  readonly blueprint: PlatformInventoryBlueprint
  readonly location: PlatformInventoryLocation
  readonly currentQuantity: PlatformInventoryQuantity
  readonly staleQuantity: PlatformInventoryQuantity
}

export interface PlatformInventorySource {
  readonly observationId: string
  readonly observedAt: string
  readonly validatedAt: string
  readonly freshUntil: string
  readonly retainedUntil: string
}

export interface PlatformInventoryHolder {
  readonly characterId: number
  readonly userId: string
  readonly characterName: string
  readonly groupKey: string
  readonly currentQuantity: PlatformInventoryQuantity
  readonly staleQuantity: PlatformInventoryQuantity
  readonly source: PlatformInventorySource
}

export interface PlatformInventoryCoverage {
  readonly characterId: number
  readonly characterName: string
  readonly state: PlatformInventoryCoverageState
  readonly source: PlatformInventorySource | null
}

export interface PlatformInventoryPage<Row> {
  readonly rows: readonly Row[]
  readonly endCursor: string | null
  readonly hasNextPage: boolean
}

export interface PlatformInventoryView<
  Scope extends PlatformInventoryScope = PlatformInventoryScope,
> {
  readonly version: typeof platformInventoryContractVersion
  readonly scope: Scope
  readonly corporationId: Scope extends 'corporation' ? number : null
  readonly fingerprint: string
  readonly traversalComplete: boolean
  readonly sourcesComplete: boolean
  readonly expectedSubjects: number
  readonly coverageCounts: Readonly<Record<PlatformInventoryCoverageState, number>>
  readonly groups: PlatformInventoryPage<PlatformInventoryGroup>
  readonly holders: PlatformInventoryPage<PlatformInventoryHolder>
  readonly coverage: PlatformInventoryPage<PlatformInventoryCoverage>
}

export interface PlatformInventoryFilters {
  readonly typeId?: number
  readonly groupId?: number
  readonly categoryId?: number
  readonly locationKey?: string
}

export type PlatformInventoryRead =
  | {
      readonly kind: 'groups'
      readonly filters?: PlatformInventoryFilters
      readonly first: number
      readonly after?: string
    }
  | {
      readonly kind: 'holders'
      readonly groupKey: string
      readonly first: number
      readonly after?: string
    }
  | { readonly kind: 'coverage'; readonly first: number; readonly after?: string }

export interface PlatformPersonalInventorySubject {
  readonly characterId: number
  readonly userId: string
  readonly characterLifecycle: string
  readonly authorizationRevision: number
  readonly evidenceReadable: boolean
}

export interface PlatformCorporationInventorySubject extends PlatformPersonalInventorySubject {
  readonly characterName?: string
  readonly collection?: {
    readonly state: 'current' | 'stale' | 'never-collected' | 'unavailable'
    readonly validatedAt: string | null
    readonly freshUntil: string | null
    readonly lastFailureClass: string | null
  }
  readonly corporationId: number
  readonly memberLifecycle: string
  readonly authorizationGeneration: number
  readonly disclosureRevision: number
  readonly sectionActivationRevision: number
  readonly observationId: string | null
}

export interface PlatformAdmittedPersonalInventory {
  readonly [admittedInventoryBrand]: 'personal'
  readonly scope: 'personal'
  readonly actorUserId: string
  readonly fingerprint: string
  readonly subjects: readonly PlatformPersonalInventorySubject[]
}

export interface PlatformAdmittedCorporationInventory {
  readonly [admittedInventoryBrand]: 'corporation'
  readonly scope: 'corporation'
  readonly actorUserId: string
  readonly corporationId: number
  readonly organizationVersion: number
  readonly authorizationRevision: number
  readonly fingerprint: string
  readonly subjects: readonly PlatformCorporationInventorySubject[]
}

export interface PlatformPersonalInventoryCapabilities {
  personalInventory(read: PlatformInventoryRead): Promise<PlatformInventoryView<'personal'>>
}

export interface PlatformCorporationInventoryCapabilities {
  corporationInventory(read: PlatformInventoryRead): Promise<PlatformInventoryView<'corporation'>>
}

export interface PlatformInventoryProviderCapabilities<Persistence extends object = object> {
  readonly persistence: Persistence
  readonly signal: AbortSignal
}

export type PlatformInventoryProvider = (
  admission: PlatformAdmittedCorporationInventory,
  read: PlatformInventoryRead,
) => Promise<PlatformInventoryView<'corporation'>>

export type PlatformInventoryProviderFactory<Persistence extends object = object> = (
  capabilities: PlatformInventoryProviderCapabilities<Persistence>,
) => PlatformInventoryProvider

export interface PlatformInventoryProviderDeclaration {
  readonly id: string
  readonly exportName: string
  readonly contractVersion: typeof platformInventoryContractVersion
  readonly scope: 'corporation'
  readonly sectionId: string
  readonly requiredPermission: string
  readonly maximumSubjects: number
  readonly maximumPageSize: number
  readonly persistenceOperations: readonly PlatformPersistenceOperationReference[]
}

export type PlatformInventoryConsumerDeclaration =
  | {
      readonly id: string
      readonly contractVersion: typeof platformInventoryContractVersion
      readonly scope: 'personal'
      readonly provider: 'core.character-assets'
      readonly maximumSubjects: number
      readonly maximumPageSize: number
    }
  | {
      readonly id: string
      readonly contractVersion: typeof platformInventoryContractVersion
      readonly scope: 'corporation'
      readonly provider: {
        readonly moduleId: string
        readonly providerId: string
        readonly optional: boolean
      }
      readonly requiredPermission: string
      readonly sourcePermission: string
      readonly maximumSubjects: number
      readonly maximumPageSize: number
    }

export interface PlatformInstalledInventoryProvider extends PlatformInventoryProviderDeclaration {
  readonly moduleId: string
  readonly publisherPackage: string
  readonly definition: PlatformInventoryProviderFactory
}

export interface PlatformInstalledInventoryConsumer {
  readonly moduleId: string
  readonly declaration: PlatformInventoryConsumerDeclaration
  readonly providerAvailable: boolean
}

export const definePlatformInventoryProvider =
  <Persistence extends object>(
    factory: PlatformInventoryProviderFactory<Persistence>,
  ): PlatformInventoryProviderFactory =>
  (capabilities) => {
    // SAFETY: Host composition supplies only this provider's attested read grants.
    const provider = factory(capabilities as PlatformInventoryProviderCapabilities<Persistence>)
    if (typeof provider !== 'function')
      throw new TypeError('Inventory provider must be a read function')
    return (admission, read) => provider(admission, read)
  }
