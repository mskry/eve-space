export const platformPersistenceOperationIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
export const platformPersistenceOperationIdMaxLength = 54
export const platformPersistenceOperationModes = ['read', 'write'] as const

export type PlatformPersistenceOperationMode = (typeof platformPersistenceOperationModes)[number]
export type PlatformPersistenceOperationRevision = number

declare const platformPersistenceOperationTypes: unique symbol

export interface PlatformPersistenceOperationIdentity<
  ModuleId extends string = string,
  OperationId extends string = string,
  Revision extends number = number,
> {
  readonly moduleId: ModuleId
  readonly operationId: OperationId
  readonly revision: Revision
}

export interface PlatformPersistenceOperationReference<OperationId extends string = string> {
  readonly operationId: OperationId
}

export interface PlatformPersistenceContributionReferences<OperationId extends string = string> {
  readonly persistenceOperations: readonly PlatformPersistenceOperationReference<OperationId>[]
}

export interface PlatformResourcePersistenceReferences<OperationId extends string = string> {
  readonly projection: readonly PlatformPersistenceOperationReference<OperationId>[]
  readonly materialization: readonly PlatformPersistenceOperationReference<OperationId>[]
}

export interface PlatformPersistenceOperationContract<
  OperationId extends string = string,
  MethodName extends string = string,
  Revision extends number = number,
  Mode extends PlatformPersistenceOperationMode = PlatformPersistenceOperationMode,
  Input = unknown,
  Output = unknown,
> {
  readonly id: OperationId
  readonly method: MethodName
  readonly revision: Revision
  readonly mode: Mode
  readonly [platformPersistenceOperationTypes]?: {
    readonly input: Input
    readonly output: Output
  }
}

export type PlatformPersistenceOperationMap = Readonly<
  Record<string, PlatformPersistenceOperationContract>
>

export interface PlatformPersistenceOperationContribution<
  OperationId extends string = string,
  MethodName extends string = string,
> extends PlatformPersistenceOperationContract<OperationId, MethodName> {
  readonly exportName: string
  readonly migration: string
}

export type PlatformPersistenceOperationInput<
  Operation extends PlatformPersistenceOperationContract,
> =
  Operation extends PlatformPersistenceOperationContract<
    string,
    string,
    number,
    PlatformPersistenceOperationMode,
    infer Input,
    unknown
  >
    ? Input
    : never

export type PlatformPersistenceOperationOutput<
  Operation extends PlatformPersistenceOperationContract,
> =
  Operation extends PlatformPersistenceOperationContract<
    string,
    string,
    number,
    PlatformPersistenceOperationMode,
    unknown,
    infer Output
  >
    ? Output
    : never

export type PlatformPersistenceMethodsFor<
  Operations extends PlatformPersistenceOperationMap,
  OperationIds extends readonly (keyof Operations & string)[],
> = {
  readonly [OperationId in OperationIds[number] as Operations[OperationId]['method']]: (
    input: PlatformPersistenceOperationInput<Operations[OperationId]>,
  ) => Promise<PlatformPersistenceOperationOutput<Operations[OperationId]>>
}

export type PlatformPersistenceMethodsForReferences<
  Operations extends PlatformPersistenceOperationMap,
  References extends readonly PlatformPersistenceOperationReference<keyof Operations & string>[],
> = PlatformPersistenceMethodsFor<
  Operations,
  readonly (References[number]['operationId'] & keyof Operations & string)[]
>

export interface PlatformPersistenceCapability<
  Operations extends PlatformPersistenceOperationMap,
  References extends readonly PlatformPersistenceOperationReference<keyof Operations & string>[],
> {
  readonly persistence: PlatformPersistenceMethodsForReferences<Operations, References>
}
