import type {
  PlatformModulePersistence,
  PlatformModuleResourceTransaction,
} from '@eve-space/platform-module-contract'
import { AsyncLocalStorage } from 'node:async_hooks'
import type postgres from 'postgres'
import { modulePersistenceNames } from './module-persistence-provisioner.js'

export type ModulePersistenceTransaction = postgres.TransactionSql

export function createModulePersistenceCapability(
  connection: postgres.Sql,
  moduleId: string,
): PlatformModulePersistence<ModulePersistenceTransaction> {
  const { runtimeRoleName, schemaName } = modulePersistenceNames(moduleId)

  return {
    transaction: async <T>(
      operation: (transaction: ModulePersistenceTransaction) => Promise<T>,
    ) => {
      const result = await connection.begin(async (transaction) => {
        await transaction`set local role ${transaction(runtimeRoleName)}`
        await transaction`
          select set_config('search_path', ${`pg_catalog, ${schemaName}`}, true)
        `
        return operation(transaction)
      })
      return result as T
    },
  }
}

export interface ScopedModulePersistence {
  readonly capability: PlatformModulePersistence<PlatformModuleResourceTransaction>
  /**
   * The first persistence failure, retained even when module code caught it. Module code that
   * swallows a failed write must not leave the platform recording a collection success.
   */
  suppressedFailure(): { readonly error: unknown } | undefined
}

export function createTransactionScopedModulePersistenceCapability(
  transaction: ModulePersistenceTransaction,
  moduleId: string,
): ScopedModulePersistence {
  const { runtimeRoleName, schemaName } = modulePersistenceNames(moduleId)
  const operationScope = new AsyncLocalStorage<boolean>()
  let used = false
  let failure: { readonly error: unknown } | undefined

  async function runOperation<T>(
    operation: (transaction: PlatformModuleResourceTransaction) => Promise<T>,
  ) {
    if (operationScope.getStore())
      throw new Error('Nested module resource transactions are not supported')
    if (used) throw new Error('Module resource transaction capability is single-use')
    used = true

    const [session] = await transaction<{ role: string; search_path: string }[]>`
      select current_user as role, current_setting('search_path') as search_path
    `
    if (!session) throw new Error('Unable to capture platform transaction settings')

    const result = await operationScope.run(true, () =>
      // The savepoint keeps a module failure from poisoning the platform transaction, and
      // rolling back to it reverts the module role and search_path along with the writes.
      transaction.savepoint(async (scope) => {
        await scope`set local role ${scope(runtimeRoleName)}`
        await scope`select set_config('search_path', ${`pg_catalog, ${schemaName}`}, true)`
        let active = true
        const scopedTransaction: PlatformModuleResourceTransaction = {
          async query<Row extends object>(statement: string, parameters: readonly unknown[] = []) {
            if (!active) throw new Error('Module resource transaction is no longer active')
            const rows = await scope.unsafe(statement, [...parameters] as never[])
            return rows as unknown as readonly Row[]
          },
        }
        try {
          return await operation(scopedTransaction)
        } finally {
          active = false
        }
      }),
    )

    await transaction`set local role ${transaction(session.role)}`
    await transaction`select set_config('search_path', ${session.search_path}, true)`
    return result as T
  }

  return {
    capability: {
      transaction: async <T>(
        operation: (transaction: PlatformModuleResourceTransaction) => Promise<T>,
      ) => {
        try {
          return await runOperation(operation)
        } catch (error) {
          failure ??= { error }
          throw error
        }
      },
    },
    suppressedFailure: () => failure,
  }
}
