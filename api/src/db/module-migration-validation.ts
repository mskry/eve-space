import type { Migration } from './migration-validation.js'
import {
  assertModuleSql,
  ModuleSqlValidationError,
  type ModuleSqlValidationCategory,
} from './module-sql-validation.js'

export type ModuleMigrationValidationCategory = ModuleSqlValidationCategory

export async function assertModuleMigrationSql(
  moduleId: string,
  schemaName: string,
  migration: Migration,
) {
  try {
    await assertModuleSql(schemaName, migration.sql)
  } catch (error) {
    if (error instanceof ModuleMigrationValidationError) throw error
    if (error instanceof ModuleSqlValidationError)
      throw new ModuleMigrationValidationError(moduleId, migration.name, error.category)
    throw new ModuleMigrationValidationError(moduleId, migration.name, 'parse')
  }
}

export class ModuleMigrationValidationError extends Error {
  constructor(
    readonly moduleId: string,
    readonly migrationName: string,
    readonly category: ModuleMigrationValidationCategory,
  ) {
    super(`Module migration ${moduleId}/${migrationName} rejected: ${category}`)
    this.name = 'ModuleMigrationValidationError'
  }
}
