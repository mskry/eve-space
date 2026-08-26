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

export function createTransactionScopedModulePersistenceCapability(
  transaction: ModulePersistenceTransaction,
  moduleId: string,
): PlatformModulePersistence<PlatformModuleResourceTransaction> {
  const { runtimeRoleName, schemaName } = modulePersistenceNames(moduleId)
  const operationScope = new AsyncLocalStorage<boolean>()
  let activeOperation: Promise<unknown> | undefined

  return {
    transaction: async <T>(
      operation: (transaction: PlatformModuleResourceTransaction) => Promise<T>,
    ) => {
      if (operationScope.getStore())
        throw new Error('Nested module resource transactions are not supported')
      if (activeOperation) {
        await activeOperation.catch(() => undefined)
        throw new Error('Module resource transaction capability is single-use')
      }

      const current = operationScope.run(true, async () => {
        await transaction`set local role ${transaction(runtimeRoleName)}`
        await transaction`
          select set_config('search_path', ${`pg_catalog, ${schemaName}`}, true)
        `
        let active = true
        const scopedTransaction: PlatformModuleResourceTransaction = {
          async query<Row extends object>(statement: string, parameters: readonly unknown[] = []) {
            if (!active) throw new Error('Module resource transaction is no longer active')
            const rows = await transaction.unsafe(statement, [...parameters] as never[])
            return rows as unknown as readonly Row[]
          },
        }
        let result: T
        try {
          result = await operation(scopedTransaction)
        } finally {
          active = false
        }
        await transaction`reset role`
        await transaction`select set_config('search_path', 'pg_catalog, public', true)`
        return result
      })
      activeOperation = current
      return current
    },
  }
}
