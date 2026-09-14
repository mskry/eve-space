import {
  platformModuleIdMaxLength,
  platformModuleIdPattern,
  platformPersistenceOperationIdMaxLength,
  platformPersistenceOperationIdPattern,
} from '@eve-space/platform-module-contract'

export function modulePersistenceNames(moduleId: string) {
  if (!platformModuleIdPattern.test(moduleId) || moduleId.length > platformModuleIdMaxLength)
    throw new Error(`Invalid module persistence owner ${moduleId}`)

  const identity = moduleId.replaceAll('-', '_')
  return {
    migrationRoleName: `eve_module_${identity}_migrate`,
    schemaName: `eve_module_${identity}`,
    runtimeRoleName: `eve_module_${identity}_runtime`,
  }
}

export function modulePersistenceRoutineName(operationId: string) {
  if (
    !platformPersistenceOperationIdPattern.test(operationId) ||
    operationId.length > platformPersistenceOperationIdMaxLength
  )
    throw new Error(`Invalid persistence operation identity ${operationId}`)
  return `persist_${operationId.replaceAll('-', '_')}`
}
