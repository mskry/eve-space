import {
  assertModuleMigrationAstPolicy,
  ModuleMigrationPolicyError,
  type ModuleMigrationPolicyCategory,
} from './module-migration-ast-policy.js'
import { parsePostgres17Migration, PostgresMigrationParseError } from './postgres17-parser.js'

export type ModuleSqlValidationCategory = 'parse' | ModuleMigrationPolicyCategory

export async function assertModuleSql(schemaName: string, statement: string) {
  try {
    const ast = await parsePostgres17Migration(statement)
    assertModuleMigrationAstPolicy(schemaName, ast)
  } catch (error) {
    if (error instanceof PostgresMigrationParseError) throw new ModuleSqlValidationError('parse')
    if (error instanceof ModuleMigrationPolicyError)
      throw new ModuleSqlValidationError(error.category)
    throw new ModuleSqlValidationError('parse')
  }
}

export class ModuleSqlValidationError extends Error {
  constructor(readonly category: ModuleSqlValidationCategory) {
    super(`Module SQL rejected: ${category}`)
    this.name = 'ModuleSqlValidationError'
  }
}
