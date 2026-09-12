import type { Migration } from './migration-validation.js'
import {
  assertModuleMigrationAstPolicy,
  ModuleMigrationPolicyError,
  type ModuleMigrationPolicyCategory,
} from './module-migration-ast-policy.js'
import { parsePostgres17Migration, PostgresMigrationParseError } from './postgres17-parser.js'

export type ModuleMigrationValidationCategory = 'parse' | ModuleMigrationPolicyCategory

export async function assertModuleMigrationSql(
  moduleId: string,
  schemaName: string,
  migration: Migration,
) {
  try {
    const ast = await parsePostgres17Migration(migration.sql)
    assertModuleMigrationAstPolicy(schemaName, ast)
  } catch (error) {
    if (error instanceof ModuleMigrationValidationError) throw error
    if (error instanceof PostgresMigrationParseError)
      throw new ModuleMigrationValidationError(moduleId, migration.name, 'parse')
    if (error instanceof ModuleMigrationPolicyError)
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
