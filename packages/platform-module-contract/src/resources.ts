import type { CoreDataMethodsFor, CoreDataProductId } from '@eve-space/core-data-contract'
import type { PlatformResourcePersistenceReferences } from './persistence.js'
import type { PlatformModuleContributionCapabilities, PlatformModuleLogger } from './server.js'

export const platformSubjectKinds = ['deployment', 'character', 'corporation', 'alliance'] as const
export type PlatformSubjectKind = (typeof platformSubjectKinds)[number]

export const platformResourceBatchModes = ['complete-observation', 'change-hint'] as const
export type PlatformResourceBatchMode = (typeof platformResourceBatchModes)[number]

export interface PlatformResourceBatchContribution {
  readonly mode: PlatformResourceBatchMode
  readonly operationId: string
}

interface PlatformResourceContributionBase {
  readonly coreDataProducts?: readonly CoreDataProductId[]
  readonly dependentOperationIds?: readonly string[]
  readonly persistence: PlatformResourcePersistenceReferences
  readonly scheduled?: boolean
  readonly id: string
  readonly operationId: string
  readonly materializationIntervalSeconds: number
  readonly exportName: string
  readonly sectionId?: string
}

export type PlatformResourceContribution =
  | (PlatformResourceContributionBase & {
      readonly batch?: never
      readonly subjectKind: 'deployment'
      readonly eligibility: { readonly kind: 'current-deployment' }
    })
  | (PlatformResourceContributionBase & {
      readonly batch?: PlatformResourceBatchContribution
      readonly subjectKind: 'character'
      readonly eligibility: { readonly kind: 'current-owned-character' }
    })
  | (PlatformResourceContributionBase & {
      readonly batch?: PlatformResourceBatchContribution
      readonly sectionId: string
      readonly subjectKind: 'character'
      readonly eligibility: { readonly kind: 'current-managed-member-character' }
    })
  | (PlatformResourceContributionBase & {
      readonly batch?: never
      readonly subjectKind: 'corporation'
      readonly eligibility: { readonly kind: 'current-managed-corporation-source' }
    })
  | (PlatformResourceContributionBase & {
      readonly batch?: never
      readonly subjectKind: 'alliance'
      readonly eligibility: { readonly kind: 'current-managed-alliance' }
    })

export interface PlatformCharacterResourceSubject {
  readonly kind: 'character'
  readonly characterId: number
  readonly lifecycleId: string
}

export interface PlatformCorporationResourceSubject {
  readonly kind: 'corporation'
  readonly corporationId: number
  readonly lifecycleId: string
}

export interface PlatformAllianceResourceSubject {
  readonly kind: 'alliance'
  readonly allianceId: number
  readonly lifecycleId: string
}

export interface PlatformDeploymentResourceSubject {
  readonly kind: 'deployment'
  readonly deploymentId: number
  readonly lifecycleId: string
}

export type PlatformResourceSubject =
  | PlatformDeploymentResourceSubject
  | PlatformCharacterResourceSubject
  | PlatformCorporationResourceSubject
  | PlatformAllianceResourceSubject

export type PlatformModuleResourceCapabilities<
  Persistence extends object = object,
  ProductIds extends readonly CoreDataProductId[] = readonly [],
> = PlatformModuleContributionCapabilities<Persistence, ProductIds>

export interface PlatformModuleResourceMaterializationCapabilities<
  Persistence extends object = object,
> {
  readonly logger: PlatformModuleLogger
  readonly persistence: Persistence
}

export interface PlatformManagedResourceAuthority {
  readonly organizationDeploymentId: 1
  readonly organizationVersion: number
  readonly targetUserId: string
  readonly managedMemberLifecycleId: string
  readonly sectionId: string
  readonly disclosureVersion: number
  readonly sectionActivationVersion: number
}

export interface PlatformResourceMaterializationContext<
  Data,
  Subject extends PlatformResourceSubject = PlatformResourceSubject,
  Persistence extends object = object,
> {
  readonly subject: Subject
  readonly data: Data
  readonly validatedAt: string
  readonly authorizationGeneration: number | null
  readonly organizationVersion: number | null
  readonly managedAuthority: PlatformManagedResourceAuthority | null
  readonly capabilities: PlatformModuleResourceMaterializationCapabilities<Persistence>
}

export interface PlatformResourceInvalidAuthority {
  readonly organizationVersion: number
  readonly targetUserId: string
  readonly managedMemberLifecycleId: string
  readonly characterId: number
  readonly characterLifecycleId: string
  readonly authorizationGeneration: number
  readonly disclosureVersion: number
  readonly sectionActivationVersion: number
}

export interface PlatformResourceMaintenanceContext<Persistence extends object = object> {
  readonly now: string
  readonly purgeAccountIds: readonly string[]
  readonly invalidAuthorities: readonly PlatformResourceInvalidAuthority[]
  readonly purgeRetention: boolean
  readonly signal?: AbortSignal
  readonly capabilities: PlatformModuleResourceMaterializationCapabilities<Persistence>
}

export interface PlatformResourceMappingCapabilities<
  ProductIds extends readonly CoreDataProductId[] = readonly [],
> {
  readonly coreData: CoreDataMethodsFor<ProductIds>
}

export interface PlatformResourceMappingContext<
  OperationData,
  Subject extends PlatformResourceSubject = PlatformResourceSubject,
  ProductIds extends readonly CoreDataProductId[] = readonly [],
> {
  readonly subject: Subject
  readonly data: OperationData
  readonly capabilities: PlatformResourceMappingCapabilities<ProductIds>
}

export type PlatformCompleteObservationBatchOutcome<Data> =
  | {
      readonly subject: PlatformCharacterResourceSubject
      readonly outcome: 'complete'
      readonly data: Data
    }
  | {
      readonly subject: PlatformCharacterResourceSubject
      readonly outcome: 'unchanged'
    }

export type PlatformChangeHintBatchOutcome = {
  readonly subject: PlatformCharacterResourceSubject
  readonly outcome: 'changed' | 'unchanged'
}

interface PlatformResourceBatchOperationBase<Operation extends string> {
  readonly operation: Operation
  request(subjects: readonly PlatformCharacterResourceSubject[]): Readonly<Record<string, unknown>>
}

export type PlatformResourceBatchOperationImplementation<
  Operation extends string = string,
  Data = unknown,
  BatchData = unknown,
> =
  | (PlatformResourceBatchOperationBase<Operation> & {
      readonly mode: 'complete-observation'
      classify(input: {
        readonly subjects: readonly PlatformCharacterResourceSubject[]
        readonly data: BatchData
      }): readonly PlatformCompleteObservationBatchOutcome<Data>[]
    })
  | (PlatformResourceBatchOperationBase<Operation> & {
      readonly mode: 'change-hint'
      classify(input: {
        readonly subjects: readonly PlatformCharacterResourceSubject[]
        readonly data: BatchData
      }): readonly PlatformChangeHintBatchOutcome[]
    })

export interface PlatformResourceCollectionContext<
  Subject extends PlatformResourceSubject,
  ProductIds extends readonly CoreDataProductId[] = readonly [],
  Persistence extends object = object,
> {
  readonly subject: Subject
  readonly organizationVersion: number
  readonly corporationId: number | null
  readonly authorizationGeneration: number | null
  readonly managedAuthority: PlatformManagedResourceAuthority | null
  readonly capabilities: PlatformModuleResourceCapabilities<Persistence, ProductIds>
  readonly requestBudget: number
  execute(
    operationId: string,
    inputs: Readonly<Record<string, unknown>>,
  ): Promise<{
    readonly data: unknown
    readonly validatedAt: string
    readonly pagination?: {
      readonly pages?: number
    }
  }>
}

export interface PlatformResourceCollectionResult<Data> {
  readonly data: Data
  readonly complete: boolean
}

export interface PlatformResourceOperationImplementation<
  Operation extends string = string,
  OperationData = unknown,
  Data = unknown,
  BatchOperation extends string = string,
  BatchData = unknown,
  Subject extends PlatformResourceSubject = PlatformCharacterResourceSubject,
  ProductIds extends readonly CoreDataProductId[] = readonly [],
  ProjectionPersistence extends object = object,
  MaterializationPersistence extends object = object,
  MaintenancePersistence extends object = object,
> {
  readonly operation: Operation
  collect?(
    context: PlatformResourceCollectionContext<Subject, ProductIds, ProjectionPersistence>,
  ): Promise<PlatformResourceCollectionResult<Data>>
  request(subject: Subject): Readonly<Record<string, unknown>>
  map(
    input: PlatformResourceMappingContext<OperationData, Subject, ProductIds>,
  ): Data | Promise<Data>
  materialize(
    context: PlatformResourceMaterializationContext<Data, Subject, MaterializationPersistence>,
  ): Promise<void | { readonly outcome: 'obsolete' }>
  maintain?(context: PlatformResourceMaintenanceContext<MaintenancePersistence>): Promise<void>
  readonly batch?: PlatformResourceBatchOperationImplementation<BatchOperation, Data, BatchData>
}

type PlatformResourceImplementationParts<Implementation> =
  Implementation extends PlatformResourceOperationImplementation<
    infer Operation,
    infer OperationData,
    infer Data,
    infer BatchOperation,
    infer BatchData,
    infer Subject,
    infer ProductIds,
    infer ProjectionPersistence,
    infer MaterializationPersistence,
    infer MaintenancePersistence
  >
    ? readonly [
        operation: Operation,
        operationData: OperationData,
        data: Data,
        batchOperation: BatchOperation,
        batchData: BatchData,
        subject: Subject,
        productIds: ProductIds,
        projectionPersistence: ProjectionPersistence,
        materializationPersistence: MaterializationPersistence,
        maintenancePersistence: MaintenancePersistence,
      ]
    : never

type PlatformResourceImplementationProductIds<Implementation> =
  PlatformResourceImplementationParts<Implementation>[6]

type PlatformResourceImplementationProjectionPersistence<Implementation> =
  PlatformResourceImplementationParts<Implementation>[7]

type PlatformResourceImplementationMaterializationPersistence<Implementation> =
  PlatformResourceImplementationParts<Implementation>[8]

type PlatformResourceImplementationMaintenancePersistence<Implementation> =
  PlatformResourceImplementationParts<Implementation>[9]

type SameProductIds<Left, Right> = [Left] extends [Right]
  ? [Right] extends [Left]
    ? true
    : false
  : false

type NormalizedPersistence<Persistence> = {
  readonly [Method in keyof Persistence]: Persistence[Method]
}

type SamePersistence<Left, Right> = SameProductIds<
  NormalizedPersistence<Left>,
  NormalizedPersistence<Right>
>

export type PlatformResourceImplementationForProducts<
  Implementation,
  ProductIds extends readonly CoreDataProductId[],
> =
  SameProductIds<PlatformResourceImplementationProductIds<Implementation>, ProductIds> extends true
    ? Implementation
    : never

export type PlatformResourceImplementationForCapabilities<
  Implementation,
  ProductIds extends readonly CoreDataProductId[],
  ProjectionPersistence extends object,
  MaterializationPersistence extends object,
> =
  SameProductIds<PlatformResourceImplementationProductIds<Implementation>, ProductIds> extends true
    ? SamePersistence<
        PlatformResourceImplementationProjectionPersistence<Implementation>,
        ProjectionPersistence
      > extends true
      ? SamePersistence<
          PlatformResourceImplementationMaterializationPersistence<Implementation> &
            PlatformResourceImplementationMaintenancePersistence<Implementation>,
          MaterializationPersistence
        > extends true
        ? Implementation
        : never
      : never
    : never

export function definePlatformResourceOperation<
  const Operation extends string,
  OperationData,
  Data,
  const BatchOperation extends string = string,
  BatchData = unknown,
  const ProductIds extends readonly CoreDataProductId[] = readonly [],
  ProjectionPersistence extends object = object,
  MaterializationPersistence extends object = object,
  MaintenancePersistence extends object = object,
>(
  implementation: PlatformResourceOperationImplementation<
    Operation,
    OperationData,
    Data,
    BatchOperation,
    BatchData,
    PlatformCharacterResourceSubject,
    ProductIds,
    ProjectionPersistence,
    MaterializationPersistence,
    MaintenancePersistence
  >,
): PlatformResourceOperationImplementation<
  Operation,
  OperationData,
  Data,
  BatchOperation,
  BatchData,
  PlatformCharacterResourceSubject,
  ProductIds,
  ProjectionPersistence,
  MaterializationPersistence,
  MaintenancePersistence
> {
  return implementation
}

interface PlatformInstalledResourceDescriptorBase<
  Implementation,
  ProductIds extends readonly CoreDataProductId[],
> {
  readonly coreDataProducts?: ProductIds
  readonly dependentOperationIds?: readonly string[]
  readonly moduleId: string
  readonly resourceId: string
  readonly operationId: string
  readonly materializationIntervalSeconds: number
  readonly persistence?: PlatformResourcePersistenceReferences
  readonly scheduled?: boolean
  readonly implementation: Implementation
  readonly sectionId?: string
}

export type PlatformInstalledResourceDescriptor<
  Implementation = unknown,
  ProductIds extends readonly CoreDataProductId[] = readonly CoreDataProductId[],
> =
  | (PlatformInstalledResourceDescriptorBase<Implementation, ProductIds> & {
      readonly batch?: never
      readonly subjectKind: 'deployment'
      readonly eligibility: { readonly kind: 'current-deployment' }
    })
  | (PlatformInstalledResourceDescriptorBase<Implementation, ProductIds> & {
      readonly batch?: PlatformResourceBatchContribution
      readonly subjectKind: 'character'
      readonly eligibility: { readonly kind: 'current-owned-character' }
    })
  | (PlatformInstalledResourceDescriptorBase<Implementation, ProductIds> & {
      readonly batch?: PlatformResourceBatchContribution
      readonly sectionId: string
      readonly subjectKind: 'character'
      readonly eligibility: { readonly kind: 'current-managed-member-character' }
    })
  | (PlatformInstalledResourceDescriptorBase<Implementation, ProductIds> & {
      readonly batch?: never
      readonly subjectKind: 'corporation'
      readonly eligibility: { readonly kind: 'current-managed-corporation-source' }
    })
  | (PlatformInstalledResourceDescriptorBase<Implementation, ProductIds> & {
      readonly batch?: never
      readonly subjectKind: 'alliance'
      readonly eligibility: { readonly kind: 'current-managed-alliance' }
    })
