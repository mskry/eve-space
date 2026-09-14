import {
  platformExportNamePattern,
  platformPersistenceOperationIdMaxLength,
  platformPersistenceOperationIdPattern,
  platformPersistenceOperationModes,
  type PlatformPersistenceOperationContract,
  type PlatformPersistenceOperationMode,
} from '@eve-space/platform-module-contract'
import { z } from 'zod'

export const platformPersistencePayloadMaximumBytes = 16 * 1024 * 1024

export interface PlatformPersistenceOperationDefinition<
  OperationId extends string = string,
  MethodName extends string = string,
  Revision extends number = number,
  Mode extends PlatformPersistenceOperationMode = PlatformPersistenceOperationMode,
  InputSchema extends z.ZodType = z.ZodType,
  OutputSchema extends z.ZodType = z.ZodType,
> extends PlatformPersistenceOperationContract<
  OperationId,
  MethodName,
  Revision,
  Mode,
  z.input<InputSchema>,
  z.output<OutputSchema>
> {
  readonly inputSchema: InputSchema
  readonly outputSchema: OutputSchema
  readonly maximumInputBytes: number
  readonly maximumOutputBytes: number
}

export interface PlatformInstalledPersistenceOperationDescriptor {
  readonly moduleId: string
  readonly operationId: string
  readonly method: string
  readonly revision: number
  readonly mode: PlatformPersistenceOperationMode
  readonly migration: string
  readonly schemaName: string
  readonly routineName: string
  readonly definitionFingerprint: string
  readonly definition: PlatformPersistenceOperationDefinition
  readonly grants: {
    readonly routes: readonly string[]
    readonly activityProviders: readonly string[]
    readonly resourceProjections: readonly string[]
    readonly resourceMaterializations: readonly string[]
  }
}

export type PlatformPersistenceOperationInvoker = (
  operation: PlatformInstalledPersistenceOperationDescriptor,
  input: unknown,
) => Promise<unknown>

export function bindPlatformPersistenceOperation<
  const Definition extends PlatformInstalledPersistenceOperationDescriptor,
>(definition: Definition, invoke: PlatformPersistenceOperationInvoker) {
  return async (
    input: z.input<Definition['definition']['inputSchema']>,
  ): Promise<z.output<Definition['definition']['outputSchema']>> =>
    (await invoke(definition, input)) as z.output<Definition['definition']['outputSchema']>
}

export function definePlatformPersistenceOperation<
  const OperationId extends string,
  const MethodName extends string,
  const Revision extends number,
  const Mode extends PlatformPersistenceOperationMode,
  InputSchema extends z.ZodType,
  OutputSchema extends z.ZodType,
>(definition: {
  readonly id: OperationId
  readonly method: MethodName
  readonly revision: Revision
  readonly mode: Mode
  readonly inputSchema: InputSchema
  readonly outputSchema: OutputSchema
  readonly maximumInputBytes: number
  readonly maximumOutputBytes: number
}): PlatformPersistenceOperationDefinition<
  OperationId,
  MethodName,
  Revision,
  Mode,
  InputSchema,
  OutputSchema
> {
  if (
    !platformPersistenceOperationIdPattern.test(definition.id) ||
    definition.id.length > platformPersistenceOperationIdMaxLength
  )
    throw new Error(`Invalid persistence operation identity: ${definition.id}`)
  if (!platformExportNamePattern.test(definition.method))
    throw new Error(`Invalid persistence operation method: ${definition.method}`)
  if (!Number.isSafeInteger(definition.revision) || definition.revision < 1)
    throw new Error(`Invalid persistence operation revision: ${definition.id}`)
  if (!(platformPersistenceOperationModes as readonly string[]).includes(definition.mode))
    throw new Error(`Invalid persistence operation mode: ${definition.id}`)
  assertPayloadBound(definition.maximumInputBytes, definition.id, 'input')
  assertPayloadBound(definition.maximumOutputBytes, definition.id, 'output')
  return definition
}

function assertPayloadBound(value: number, operationId: string, direction: 'input' | 'output') {
  if (!Number.isSafeInteger(value) || value < 1 || value > platformPersistencePayloadMaximumBytes)
    throw new Error(`Invalid persistence operation ${direction} bound: ${operationId}`)
}
