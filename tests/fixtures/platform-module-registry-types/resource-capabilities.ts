import type {
  PlatformBoundedCollectionResourceImplementation,
  PlatformCharacterResourceSubject,
  PlatformResourceImplementationForCapabilities,
  PlatformResourceOperationContract,
} from '@eve-space/platform-module-contract/resources'

interface ProjectionPersistence {
  readonly readCheckpoint: (input: { readonly resourceId: string }) => Promise<{ revision: number }>
}

interface MaterializationPersistence {
  readonly writeSnapshot: (input: { readonly revision: number }) => Promise<{ applied: true }>
}

interface MaintenancePersistence {
  readonly purgeSnapshots: (input: { readonly before: string }) => Promise<{ deleted: number }>
}

interface ExcessPersistence {
  readonly undeclaredMethod: (input: { readonly value: string }) => Promise<void>
}

type ResourceImplementation = PlatformBoundedCollectionResourceImplementation<
  'fixture-operation',
  { readonly 'fixture-operation': PlatformResourceOperationContract },
  unknown,
  string,
  unknown,
  PlatformCharacterResourceSubject,
  readonly ['published-type-groups'],
  ProjectionPersistence,
  MaterializationPersistence,
  MaintenancePersistence
>

declare const resource: ResourceImplementation

void (resource satisfies PlatformResourceImplementationForCapabilities<
  typeof resource,
  readonly ['published-type-groups'],
  ProjectionPersistence,
  MaterializationPersistence & MaintenancePersistence
>)

// @ts-expect-error projection grants cannot omit an implementation requirement
void (resource satisfies PlatformResourceImplementationForCapabilities<
  typeof resource,
  readonly ['published-type-groups'],
  object,
  MaterializationPersistence & MaintenancePersistence
>)

// @ts-expect-error projection grants cannot include a method outside the implementation interface
void (resource satisfies PlatformResourceImplementationForCapabilities<
  typeof resource,
  readonly ['published-type-groups'],
  ProjectionPersistence & ExcessPersistence,
  MaterializationPersistence & MaintenancePersistence
>)

// @ts-expect-error projection method input and output contracts must agree exactly
void (resource satisfies PlatformResourceImplementationForCapabilities<
  typeof resource,
  readonly ['published-type-groups'],
  {
    readonly readCheckpoint: (input: {
      readonly resourceId: number
    }) => Promise<{ revision: string }>
  },
  MaterializationPersistence & MaintenancePersistence
>)

// @ts-expect-error the generated materialization grant set must include maintenance requirements
void (resource satisfies PlatformResourceImplementationForCapabilities<
  typeof resource,
  readonly ['published-type-groups'],
  ProjectionPersistence,
  MaterializationPersistence
>)

// @ts-expect-error materialization grants cannot include a method outside either phase interface
void (resource satisfies PlatformResourceImplementationForCapabilities<
  typeof resource,
  readonly ['published-type-groups'],
  ProjectionPersistence,
  MaterializationPersistence & MaintenancePersistence & ExcessPersistence
>)

// @ts-expect-error materialization method input and output contracts must agree exactly
void (resource satisfies PlatformResourceImplementationForCapabilities<
  typeof resource,
  readonly ['published-type-groups'],
  ProjectionPersistence,
  {
    readonly writeSnapshot: (input: { readonly revision: string }) => Promise<{ applied: false }>
  } & MaintenancePersistence
>)

// @ts-expect-error maintenance method input and output contracts must agree exactly
void (resource satisfies PlatformResourceImplementationForCapabilities<
  typeof resource,
  readonly ['published-type-groups'],
  ProjectionPersistence,
  MaterializationPersistence & {
    readonly purgeSnapshots: (input: { readonly before: number }) => Promise<{ deleted: string }>
  }
>)
