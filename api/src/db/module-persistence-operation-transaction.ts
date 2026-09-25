import type { PlatformInstalledPersistenceOperationDescriptor } from '@eve-space/platform-module-server'
import type postgres from 'postgres'
import {
  createModulePersistenceOperationInvoker,
  ModulePersistenceOperationError,
  recordModulePersistenceOperationFailure,
  type ModulePersistenceOperationFailureCategory,
  type ModulePersistenceOperationTransactionRunner,
} from './module-persistence-operation.js'
import { modulePersistenceNames } from './module-persistence-identity.js'

interface StandaloneModulePersistenceOperationOptions {
  readonly readOnly?: boolean
  readonly signal?: AbortSignal
  readonly statementTimeoutMilliseconds?: number
}

export interface TransactionScopedModulePersistenceOperationInvoker {
  readonly invoke: ReturnType<typeof createModulePersistenceOperationInvoker>
  close(): void
  suppressedFailure(): { readonly error: unknown } | undefined
}

export function createStandaloneModulePersistenceOperationInvoker(
  connection: postgres.Sql,
  moduleId: string,
  installedOperations: readonly PlatformInstalledPersistenceOperationDescriptor[],
  options: StandaloneModulePersistenceOperationOptions = {},
) {
  const moduleOperations = installedOperations.filter(
    (operation) => operation.moduleId === moduleId,
  )
  const names = modulePersistenceNames(moduleId)
  const runInTransaction: ModulePersistenceOperationTransactionRunner = async <Result>(
    _operation: PlatformInstalledPersistenceOperationDescriptor,
    execute: (transaction: postgres.TransactionSql) => Promise<Result>,
  ) => {
    const result = await connection.begin(async (transaction) => {
      options.signal?.throwIfAborted()
      if (options.readOnly) {
        await transaction`set transaction read only`
      }
      await transaction`set local role ${transaction(names.runtimeRoleName)}`
      await transaction`
        select set_config('search_path', ${`pg_catalog, ${names.schemaName}`}, true)
      `
      if (options.statementTimeoutMilliseconds !== undefined) {
        await transaction`
          select set_config(
            'statement_timeout',
            ${String(options.statementTimeoutMilliseconds)},
            true
          )
        `
      }
      options.signal?.throwIfAborted()
      return execute(transaction)
    })
    return result as Result
  }
  return createModulePersistenceOperationInvoker(moduleOperations, runInTransaction, {
    ...(options.readOnly && { expectedMode: 'read' as const }),
    ...(options.signal && { signal: options.signal }),
  })
}

export function createTransactionScopedModulePersistenceOperationInvoker(
  transaction: postgres.TransactionSql,
  moduleId: string,
  installedOperations: readonly PlatformInstalledPersistenceOperationDescriptor[],
  signal?: AbortSignal,
): TransactionScopedModulePersistenceOperationInvoker {
  const moduleOperations = installedOperations.filter(
    (operation) => operation.moduleId === moduleId,
  )
  const names = modulePersistenceNames(moduleId)
  let active = true
  const usedOperations = new Set<string>()
  let failure: { readonly error: unknown } | undefined
  const runInTransaction: ModulePersistenceOperationTransactionRunner = async <Result>(
    _operation: PlatformInstalledPersistenceOperationDescriptor,
    execute: (transaction: postgres.TransactionSql) => Promise<Result>,
  ) => {
    const [session] = await transaction<{ role: string; searchPath: string }[]>`
      select current_user as role, current_setting('search_path') as "searchPath"
    `
    if (!session) {
      throw new Error('Unable to capture platform transaction settings')
    }
    const result = await transaction.savepoint(async (scope) => {
      await scope`set local role ${scope(names.runtimeRoleName)}`
      await scope`
        select set_config('search_path', ${`pg_catalog, ${names.schemaName}`}, true)
      `
      return execute(scope)
    })
    await transaction`set local role ${transaction(session.role)}`
    await transaction`select set_config('search_path', ${session.searchPath}, true)`
    return result as Result
  }
  const invokeOperation = createModulePersistenceOperationInvoker(
    moduleOperations,
    runInTransaction,
    {
      assertActive: () => {
        if (!active) {
          throw new Error('Module persistence operation is no longer active')
        }
      },
      expectedMode: 'write',
      ...(signal && { signal }),
    },
  )
  return {
    close() {
      active = false
    },
    async invoke(operation, input) {
      try {
        if (!active) {
          throw scopedOperationError(operation, 'inactive')
        }
        if (usedOperations.has(operation.operationId)) {
          throw scopedOperationError(operation, 'repeated')
        }
        usedOperations.add(operation.operationId)
        return await invokeOperation(operation, input)
      } catch (error) {
        failure ??= { error }
        throw error
      }
    },
    suppressedFailure: () => failure,
  }
}

function scopedOperationError(
  operation: PlatformInstalledPersistenceOperationDescriptor,
  category: Extract<ModulePersistenceOperationFailureCategory, 'inactive' | 'repeated'>,
) {
  const error = new ModulePersistenceOperationError(
    operation.moduleId,
    operation.operationId,
    category,
  )
  recordModulePersistenceOperationFailure(error)
  return error
}
