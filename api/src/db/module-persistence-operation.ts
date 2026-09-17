import type { PlatformPersistenceOperationMode } from '@eve-space/platform-module-contract/persistence'
import type {
  PlatformInstalledPersistenceOperationDescriptor,
  PlatformPersistenceOperationInvoker,
} from '@eve-space/platform-module-server'
import type postgres from 'postgres'
import { executeCancellableQuery } from '../query-cancellation.js'
import { recordDiagnostic } from '../logging.js'

const persistenceOperationFailureCategories = [
  'binding',
  'cancelled',
  'execution',
  'inactive',
  'input',
  'input-size',
  'mode',
  'output',
  'output-size',
  'repeated',
] as const

export type ModulePersistenceOperationFailureCategory =
  (typeof persistenceOperationFailureCategories)[number]

export type ModulePersistenceOperationTransactionRunner = <Result>(
  operation: PlatformInstalledPersistenceOperationDescriptor,
  execute: (transaction: postgres.TransactionSql) => Promise<Result>,
) => Promise<Result>

interface ModulePersistenceOperationInvokerOptions {
  readonly assertActive?: () => void
  readonly expectedMode?: PlatformPersistenceOperationMode
  readonly signal?: AbortSignal
}

export function createModulePersistenceOperationInvoker(
  installedOperations: readonly PlatformInstalledPersistenceOperationDescriptor[],
  runInTransaction: ModulePersistenceOperationTransactionRunner,
  options: ModulePersistenceOperationInvokerOptions = {},
): PlatformPersistenceOperationInvoker {
  const installedBindings = new Set(installedOperations)
  const invoke = async (
    operation: PlatformInstalledPersistenceOperationDescriptor,
    input: unknown,
  ) => {
    if (!installedBindings.has(operation)) throw operationError(operation, 'binding')
    if (options.expectedMode && operation.mode !== options.expectedMode)
      throw operationError(operation, 'mode')
    assertOperationActive(operation, options)
    const parsedInput = parsePayload(
      operation,
      operation.definition.inputSchema,
      input,
      operation.definition.maximumInputBytes,
      'input',
      'input-size',
    )

    let output: unknown
    try {
      output = await runInTransaction(operation, async (transaction) => {
        const result = await executeRoutine(
          transaction,
          operation,
          parsedInput.json,
          options.signal,
        )
        assertOperationActive(operation, options)
        return parsePayload(
          operation,
          operation.definition.outputSchema,
          result,
          operation.definition.maximumOutputBytes,
          'output',
          'output-size',
        ).value
      })
    } catch (error) {
      if (error instanceof ModulePersistenceOperationError) throw error
      if (options.signal?.aborted) throw operationError(operation, 'cancelled')
      throw operationError(operation, 'execution')
    }
    return output
  }
  return async (operation, input) => {
    try {
      return await invoke(operation, input)
    } catch (error) {
      const failure =
        error instanceof ModulePersistenceOperationError
          ? error
          : operationError(operation, 'execution')
      recordModulePersistenceOperationFailure(failure)
      throw failure
    }
  }
}

export class ModulePersistenceOperationError extends Error {
  constructor(
    readonly moduleId: string,
    readonly operationId: string,
    readonly category: ModulePersistenceOperationFailureCategory,
  ) {
    super(`Module persistence operation ${moduleId}/${operationId} failed: ${category}`)
    this.name = 'ModulePersistenceOperationError'
  }
}

export function recordModulePersistenceOperationFailure(error: ModulePersistenceOperationError) {
  recordDiagnostic('platform.persistence.failed', {
    context: {
      moduleId: error.moduleId,
      operationId: error.operationId,
      persistenceFailure: error.category,
    },
    error,
  })
}

async function executeRoutine(
  transaction: postgres.TransactionSql,
  operation: PlatformInstalledPersistenceOperationDescriptor,
  inputJson: string,
  signal?: AbortSignal,
) {
  const statement = `select ${quoteIdentifier(operation.schemaName)}.${quoteIdentifier(operation.routineName)}($1::text::jsonb) as result`
  const rows = await executeCancellableQuery(
    transaction.unsafe<{ result: unknown }[]>(statement, [inputJson]),
    signal,
  )
  if (rows.length !== 1 || !Object.hasOwn(rows[0]!, 'result'))
    throw operationError(operation, 'output')
  return rows[0]!.result
}

function parsePayload(
  operation: PlatformInstalledPersistenceOperationDescriptor,
  schema: PlatformInstalledPersistenceOperationDescriptor['definition']['inputSchema'],
  value: unknown,
  maximumBytes: number,
  invalidCategory: 'input' | 'output',
  sizeCategory: 'input-size' | 'output-size',
) {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw operationError(operation, invalidCategory)
  let json: string | undefined
  try {
    json = JSON.stringify(parsed.data)
  } catch {
    throw operationError(operation, invalidCategory)
  }
  if (json === undefined) throw operationError(operation, invalidCategory)
  if (Buffer.byteLength(json, 'utf8') > maximumBytes) throw operationError(operation, sizeCategory)
  return { json, value: parsed.data }
}

function assertOperationActive(
  operation: PlatformInstalledPersistenceOperationDescriptor,
  options: ModulePersistenceOperationInvokerOptions,
) {
  try {
    options.signal?.throwIfAborted()
    options.assertActive?.()
  } catch {
    throw operationError(operation, options.signal?.aborted ? 'cancelled' : 'inactive')
  }
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`
}

function operationError(
  operation: PlatformInstalledPersistenceOperationDescriptor,
  category: ModulePersistenceOperationFailureCategory,
) {
  return new ModulePersistenceOperationError(operation.moduleId, operation.operationId, category)
}
