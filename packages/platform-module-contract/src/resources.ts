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

export interface PlatformResourceOperationContract<Input = unknown, Output = unknown> {
  readonly input: Input
  readonly output: Output
}

export type PlatformResourceOperationProtocol = Readonly<
  Record<string, PlatformResourceOperationContract>
>

export type PlatformResourceRootProtocol<Operation extends string> =
  PlatformResourceOperationProtocol & {
    readonly [Root in Operation]: PlatformResourceOperationContract
  }

export interface PlatformResourceOperationResult<Output> {
  readonly data: Output
  readonly validatedAt: string
  readonly pagination?: {
    readonly pages?: number
  }
}

export type PlatformResourceOperationMethod<Contract extends PlatformResourceOperationContract> = (
  input: Contract['input'],
) => Promise<PlatformResourceOperationResult<Contract['output']>>

export type PlatformResourceOperationMethods<Protocol extends PlatformResourceOperationProtocol> = {
  readonly [Operation in keyof Protocol & string]: PlatformResourceOperationMethod<
    Protocol[Operation]
  >
}

export interface PlatformResourceCollectionContext<
  Subject extends PlatformResourceSubject,
  Protocol extends PlatformResourceOperationProtocol,
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
  readonly operations: PlatformResourceOperationMethods<Protocol>
}

export interface PlatformResourceCollectionResult<Data> {
  readonly data: Data
  readonly complete: boolean
}

export const platformResourceExecutionModes = ['single-request', 'bounded-collection'] as const
export type PlatformResourceExecutionMode = (typeof platformResourceExecutionModes)[number]

interface PlatformResourceImplementationBase<
  Data,
  BatchOperation extends string,
  BatchData,
  Subject extends PlatformResourceSubject,
  MaterializationPersistence extends object,
  MaintenancePersistence extends object,
> {
  materialize(
    context: PlatformResourceMaterializationContext<Data, Subject, MaterializationPersistence>,
  ): Promise<void | { readonly outcome: 'obsolete' }>
  maintain?(context: PlatformResourceMaintenanceContext<MaintenancePersistence>): Promise<void>
  readonly batch?: PlatformResourceBatchOperationImplementation<BatchOperation, Data, BatchData>
}

export interface PlatformSingleRequestResourceImplementation<
  Operation extends string = string,
  Protocol extends PlatformResourceRootProtocol<Operation> =
    PlatformResourceRootProtocol<Operation>,
  Data = unknown,
  BatchOperation extends string = string,
  BatchData = unknown,
  Subject extends PlatformResourceSubject = PlatformCharacterResourceSubject,
  ProductIds extends readonly CoreDataProductId[] = readonly [],
  MaterializationPersistence extends object = object,
  MaintenancePersistence extends object = object,
> extends PlatformResourceImplementationBase<
  Data,
  BatchOperation,
  BatchData,
  Subject,
  MaterializationPersistence,
  MaintenancePersistence
> {
  readonly mode: 'single-request'
  readonly operation: Operation
  readonly collect?: never
  request(subject: Subject): Protocol[Operation]['input']
  map(
    input: PlatformResourceMappingContext<Protocol[Operation]['output'], Subject, ProductIds>,
  ): Data | Promise<Data>
}

export interface PlatformBoundedCollectionResourceImplementation<
  Operation extends string = string,
  Protocol extends PlatformResourceRootProtocol<Operation> =
    PlatformResourceRootProtocol<Operation>,
  Data = unknown,
  BatchOperation extends string = string,
  BatchData = unknown,
  Subject extends PlatformResourceSubject = PlatformCharacterResourceSubject,
  ProductIds extends readonly CoreDataProductId[] = readonly [],
  ProjectionPersistence extends object = object,
  MaterializationPersistence extends object = object,
  MaintenancePersistence extends object = object,
> extends PlatformResourceImplementationBase<
  Data,
  BatchOperation,
  BatchData,
  Subject,
  MaterializationPersistence,
  MaintenancePersistence
> {
  readonly mode: 'bounded-collection'
  readonly operation: Operation
  readonly request?: never
  readonly map?: never
  collect(
    context: PlatformResourceCollectionContext<
      Subject,
      Protocol,
      ProductIds,
      ProjectionPersistence
    >,
  ): Promise<PlatformResourceCollectionResult<Data>>
}

export type PlatformResourceImplementation =
  | PlatformSingleRequestResourceImplementation<
      string,
      PlatformResourceOperationProtocol,
      unknown,
      string,
      unknown,
      PlatformResourceSubject
    >
  | PlatformBoundedCollectionResourceImplementation<
      string,
      PlatformResourceOperationProtocol,
      unknown,
      string,
      unknown,
      PlatformResourceSubject
    >

interface PlatformResourceImplementationParts<
  Mode extends PlatformResourceExecutionMode,
  Operation extends string,
  Protocol,
  ProductIds,
  ProjectionPersistence,
  MaterializationPersistence,
  MaintenancePersistence,
> {
  readonly mode: Mode
  readonly operation: Operation
  readonly protocol: Protocol
  readonly productIds: ProductIds
  readonly projectionPersistence: ProjectionPersistence
  readonly materializationPersistence: MaterializationPersistence
  readonly maintenancePersistence: MaintenancePersistence
}

type PlatformResourceImplementationPartsOf<Implementation> =
  Implementation extends PlatformSingleRequestResourceImplementation<
    infer Operation,
    infer Protocol,
    infer _Data,
    infer _BatchOperation,
    infer _BatchData,
    infer _Subject,
    infer ProductIds,
    infer MaterializationPersistence,
    infer MaintenancePersistence
  >
    ? PlatformResourceImplementationParts<
        'single-request',
        Operation,
        Protocol,
        ProductIds,
        object,
        MaterializationPersistence,
        MaintenancePersistence
      >
    : Implementation extends PlatformBoundedCollectionResourceImplementation<
          infer Operation,
          infer Protocol,
          infer _Data,
          infer _BatchOperation,
          infer _BatchData,
          infer _Subject,
          infer ProductIds,
          infer ProjectionPersistence,
          infer MaterializationPersistence,
          infer MaintenancePersistence
        >
      ? PlatformResourceImplementationParts<
          'bounded-collection',
          Operation,
          Protocol,
          ProductIds,
          ProjectionPersistence,
          MaterializationPersistence,
          MaintenancePersistence
        >
      : never

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

type IsAny<Value> = 0 extends 1 & Value ? true : false

type SameExactType<Left, Right> =
  IsAny<Left> extends true ? false : IsAny<Right> extends true ? false : SameProductIds<Left, Right>

type SameOperationContract<Actual, Expected> =
  Actual extends PlatformResourceOperationContract<infer ActualInput, infer ActualOutput>
    ? Expected extends PlatformResourceOperationContract<infer ExpectedInput, infer ExpectedOutput>
      ? SameExactType<ActualInput, ExpectedInput> extends true
        ? SameExactType<ActualOutput, ExpectedOutput>
        : false
      : false
    : false

type SameOperationContracts<Actual, Expected> = {
  readonly [Operation in keyof Expected]: Operation extends keyof Actual
    ? SameOperationContract<Actual[Operation], Expected[Operation]>
    : false
}[keyof Expected]

type SameProtocol<Actual, Expected> =
  SameExactType<keyof Actual, keyof Expected> extends true
    ? [SameOperationContracts<Actual, Expected>] extends [true]
      ? true
      : false
    : false

type ModeAgreesWithProtocol<Mode, Operation, ExpectedProtocol> = Mode extends 'single-request'
  ? SameExactType<keyof ExpectedProtocol, Operation>
  : true

export type PlatformResourceImplementationForProducts<
  Implementation,
  ProductIds extends readonly CoreDataProductId[],
> =
  SameProductIds<
    PlatformResourceImplementationPartsOf<Implementation>['productIds'],
    ProductIds
  > extends true
    ? Implementation
    : never

export type PlatformResourceImplementationForCapabilities<
  Implementation,
  ProductIds extends readonly CoreDataProductId[],
  ProjectionPersistence extends object,
  MaterializationPersistence extends object,
> =
  PlatformResourceImplementationPartsOf<Implementation> extends infer Parts extends
    PlatformResourceImplementationParts<
      PlatformResourceExecutionMode,
      string,
      unknown,
      unknown,
      unknown,
      unknown,
      unknown
    >
    ? SameProductIds<Parts['productIds'], ProductIds> extends true
      ? SamePersistence<Parts['projectionPersistence'], ProjectionPersistence> extends true
        ? SamePersistence<
            Parts['materializationPersistence'] & Parts['maintenancePersistence'],
            MaterializationPersistence
          > extends true
          ? Implementation
          : never
        : never
      : never
    : never

export type PlatformResourceImplementationForContract<
  Implementation,
  Operation extends string,
  ExpectedProtocol extends PlatformResourceOperationProtocol,
  ProductIds extends readonly CoreDataProductId[],
  ProjectionPersistence extends object,
  MaterializationPersistence extends object,
> =
  PlatformResourceImplementationPartsOf<Implementation> extends infer Parts extends
    PlatformResourceImplementationParts<
      PlatformResourceExecutionMode,
      string,
      unknown,
      unknown,
      unknown,
      unknown,
      unknown
    >
    ? SameExactType<Parts['operation'], Operation> extends true
      ? ModeAgreesWithProtocol<Parts['mode'], Operation, ExpectedProtocol> extends true
        ? SameProtocol<Parts['protocol'], ExpectedProtocol> extends true
          ? PlatformResourceImplementationForCapabilities<
              Implementation,
              ProductIds,
              ProjectionPersistence,
              MaterializationPersistence
            >
          : never
        : never
      : never
    : never

export function definePlatformSingleRequestResource<
  const Operation extends string,
  Protocol extends PlatformResourceRootProtocol<Operation>,
  Data,
  const BatchOperation extends string = string,
  BatchData = unknown,
  Subject extends PlatformResourceSubject = PlatformCharacterResourceSubject,
  const ProductIds extends readonly CoreDataProductId[] = readonly [],
  MaterializationPersistence extends object = object,
  MaintenancePersistence extends object = object,
>(
  implementation: PlatformSingleRequestResourceImplementation<
    Operation,
    Protocol,
    Data,
    BatchOperation,
    BatchData,
    Subject,
    ProductIds,
    MaterializationPersistence,
    MaintenancePersistence
  >,
): PlatformSingleRequestResourceImplementation<
  Operation,
  Protocol,
  Data,
  BatchOperation,
  BatchData,
  Subject,
  ProductIds,
  MaterializationPersistence,
  MaintenancePersistence
> {
  return implementation
}

export function definePlatformBoundedCollectionResource<
  const Operation extends string,
  Protocol extends PlatformResourceRootProtocol<Operation>,
  Data,
  const BatchOperation extends string = string,
  BatchData = unknown,
  Subject extends PlatformResourceSubject = PlatformCharacterResourceSubject,
  const ProductIds extends readonly CoreDataProductId[] = readonly [],
  ProjectionPersistence extends object = object,
  MaterializationPersistence extends object = object,
  MaintenancePersistence extends object = object,
>(
  implementation: PlatformBoundedCollectionResourceImplementation<
    Operation,
    Protocol,
    Data,
    BatchOperation,
    BatchData,
    Subject,
    ProductIds,
    ProjectionPersistence,
    MaterializationPersistence,
    MaintenancePersistence
  >,
): PlatformBoundedCollectionResourceImplementation<
  Operation,
  Protocol,
  Data,
  BatchOperation,
  BatchData,
  Subject,
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

export type PlatformInstalledResourceDeclaration = Pick<
  PlatformInstalledResourceDescriptor,
  'eligibility' | 'moduleId' | 'operationId' | 'resourceId' | 'sectionId' | 'subjectKind'
>
