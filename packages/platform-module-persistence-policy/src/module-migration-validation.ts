import {
  assertModuleMigrationAstPolicy,
  ModuleMigrationPolicyError,
  type ModuleMigrationPersistenceRoutineDeclaration,
  type ModuleMigrationPolicyCategory,
} from './module-migration-ast-policy.js'
import { parsePostgres17Migration, PostgresMigrationParseError } from './postgres17-parser.js'

export interface PlatformModuleMigration {
  readonly name: string
  readonly sql: string
}

export type ModuleMigrationValidationCategory = 'parse' | ModuleMigrationPolicyCategory

export async function assertModuleMigrationSql(
  moduleId: string,
  schemaName: string,
  migration: PlatformModuleMigration,
  persistenceRoutines: readonly ModuleMigrationPersistenceRoutineDeclaration[] = [],
) {
  try {
    const ast = await parsePostgres17Migration(migration.sql)
    assertModuleMigrationAstPolicy(schemaName, ast, persistenceRoutines)
  } catch (error) {
    if (error instanceof ModuleMigrationValidationError) {
      throw error
    }
    if (error instanceof ModuleMigrationPolicyError) {
      throw new ModuleMigrationValidationError(moduleId, migration.name, error.category)
    }
    if (error instanceof PostgresMigrationParseError) {
      throw new ModuleMigrationValidationError(moduleId, migration.name, 'parse')
    }
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
