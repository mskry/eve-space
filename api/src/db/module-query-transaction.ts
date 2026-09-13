import type { PlatformModuleResourceTransaction } from '@eve-space/platform-module-contract'
import type postgres from 'postgres'
import {
  assertModuleSql,
  ModuleSqlValidationError,
  type ModuleSqlValidationCategory,
} from './module-sql-validation.js'

interface ModuleQueryTransactionOptions {
  readonly assertActive?: () => void
  readonly moduleId: string
  readonly schemaName: string
}

export async function withModuleQueryTransaction<T>(
  transaction: postgres.TransactionSql,
  operation: (transaction: PlatformModuleResourceTransaction) => Promise<T>,
  { assertActive = () => {}, moduleId, schemaName }: ModuleQueryTransactionOptions,
) {
  let active = true
  let failure: { readonly error: unknown } | undefined
  try {
    assertActive()
    const result = await operation({
      async query<Row extends object>(statement: string, parameters: readonly unknown[] = []) {
        if (!active) throw new Error('Module query transaction is no longer active')
        assertActive()
        try {
          await assertModuleSql(schemaName, statement)
          if (!active) throw new Error('Module query transaction is no longer active')
          assertActive()
          const rows = await transaction.unsafe(statement, [...parameters] as never[])
          return rows as unknown as readonly Row[]
        } catch (error) {
          failure ??= { error }
          throw mapValidationError(error, moduleId)
        }
      },
    })
    if (failure) throw mapValidationError(failure.error, moduleId)
    return result
  } finally {
    active = false
  }
}

export class ModuleQueryValidationError extends Error {
  constructor(
    readonly moduleId: string,
    readonly category: ModuleSqlValidationCategory,
  ) {
    super(`Module query for ${moduleId} rejected: ${category}`)
    this.name = 'ModuleQueryValidationError'
  }
}

function mapValidationError(error: unknown, moduleId: string) {
  return error instanceof ModuleSqlValidationError
    ? new ModuleQueryValidationError(moduleId, error.category)
    : error
}
