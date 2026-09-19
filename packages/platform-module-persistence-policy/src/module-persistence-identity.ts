import {
  isPlatformModuleId,
  isPlatformPersistenceOperationId,
} from '@eve-space/platform-module-contract/identifiers'

export function modulePersistenceNames(moduleId: string) {
  if (!isPlatformModuleId(moduleId)) throw new Error(`Invalid module persistence owner ${moduleId}`)

  const identity = moduleId.replaceAll('-', '_')
  return {
    migrationRoleName: `eve_module_${identity}_migrate`,
    schemaName: `eve_module_${identity}`,
    runtimeRoleName: `eve_module_${identity}_runtime`,
  }
}

export function modulePersistenceRoutineName(operationId: string) {
  if (!isPlatformPersistenceOperationId(operationId))
    throw new Error(`Invalid persistence operation identity ${operationId}`)
  return `persist_${operationId.replaceAll('-', '_')}`
}
