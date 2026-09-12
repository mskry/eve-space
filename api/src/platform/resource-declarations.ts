import type {
  PlatformInstalledResourceDescriptor,
  PlatformResourceBatchOperationImplementation,
  PlatformResourceOperationImplementation,
} from '@eve-space/platform-module-contract'
import type { PlatformExecutableEsiOperationDefinition } from '@eve-space/platform-module-server'
import {
  assertEsiPlatformExecutionConfiguration,
  assertEsiExecutableDefinition,
  assertRegisteredEsiOperation,
  getEsiOperationAuthorization,
  getEsiSetOperationConfiguration,
  getPlatformEsiOperationDefinition,
} from '../esi-gateway/catalog-interface.js'
import { platformResources } from './resources.js'

export function assertInstalledResourceDeclarations(
  resources: readonly PlatformInstalledResourceDescriptor[] = platformResources,
  definitions?: Readonly<Record<string, PlatformExecutableEsiOperationDefinition>>,
) {
  if (!definitions) assertEsiPlatformExecutionConfiguration()
  for (const resource of resources) {
    assertRegisteredEsiOperation(resource.operationId)
    assertResourceDefinition(resource, resource.operationId, definitions)
    const primary = getEsiOperationAuthorization(resource.operationId)
    if (resource.subjectKind === 'deployment' && primary.kind !== 'public')
      throw new Error('Deployment resources require public operations')
    for (const operationId of resource.dependentOperationIds ?? []) {
      assertResourceDefinition(resource, operationId, definitions)
      assertRegisteredEsiOperation(operationId)
      const dependent = getEsiOperationAuthorization(operationId)
      if (
        dependent.kind !== primary.kind ||
        (dependent.kind === 'character' &&
          primary.kind === 'character' &&
          dependent.requiredScope !== primary.requiredScope)
      )
        throw new Error('Dependent operations must retain the resource authorization contract')
    }
    assertResourceImplementation(resource, resource.implementation)
    assertResourceBatchImplementation(resource, resource.implementation, definitions)
  }
}

function getInstalledResourceEsiOperationDefinition(
  operationId: string,
  definitions?: Readonly<Record<string, PlatformExecutableEsiOperationDefinition>>,
) {
  if (!definitions) return getPlatformEsiOperationDefinition(operationId)
  const definition = definitions[operationId]
  if (!definition) throw new Error(`ESI operation ${operationId} has no executable definition`)
  return definition
}

function assertResourceImplementation(
  resource: PlatformInstalledResourceDescriptor,
  implementation: unknown,
): asserts implementation is PlatformResourceOperationImplementation {
  if (
    typeof implementation !== 'object' ||
    implementation === null ||
    !('operation' in implementation) ||
    typeof implementation.operation !== 'string' ||
    !('request' in implementation) ||
    typeof implementation.request !== 'function' ||
    !('map' in implementation) ||
    typeof implementation.map !== 'function' ||
    !('materialize' in implementation) ||
    typeof implementation.materialize !== 'function'
  )
    throw new Error(
      `Installed resource ${resource.moduleId}/${resource.resourceId} must provide operation, request, map, and materialize functions`,
    )
  if (implementation.operation !== resource.operationId)
    throw new Error(
      `Installed resource ${resource.moduleId}/${resource.resourceId} implements ${implementation.operation} instead of ${resource.operationId}`,
    )
}

function assertResourceBatchImplementation(
  resource: PlatformInstalledResourceDescriptor,
  implementation: PlatformResourceOperationImplementation,
  definitions?: Readonly<Record<string, PlatformExecutableEsiOperationDefinition>>,
) {
  const descriptor = resource.batch
  const batch = implementation.batch
  if (!descriptor && !batch) return
  if (!descriptor || !batch)
    throw new Error(
      `Installed resource ${resource.moduleId}/${resource.resourceId} must declare matching batch descriptor and implementation`,
    )

  assertRegisteredEsiOperation(descriptor.operationId)
  assertResourceDefinition(resource, descriptor.operationId, definitions)
  if (getEsiOperationAuthorization(descriptor.operationId).kind !== 'public')
    throw new Error(
      `Installed resource ${resource.moduleId}/${resource.resourceId} batch operation ${descriptor.operationId} must use public authorization`,
    )
  try {
    getEsiSetOperationConfiguration(descriptor.operationId)
  } catch {
    throw new Error(
      `Installed resource ${resource.moduleId}/${resource.resourceId} batch operation ${descriptor.operationId} must use set identity`,
    )
  }
  assertBatchFunctions(resource, batch)
  if (batch.mode !== descriptor.mode)
    throw new Error(
      `Installed resource ${resource.moduleId}/${resource.resourceId} implements batch mode ${batch.mode} instead of ${descriptor.mode}`,
    )
  if (batch.operation !== descriptor.operationId)
    throw new Error(
      `Installed resource ${resource.moduleId}/${resource.resourceId} implements batch operation ${batch.operation} instead of ${descriptor.operationId}`,
    )
}

function assertResourceDefinition(
  resource: PlatformInstalledResourceDescriptor,
  operationId: string,
  definitions?: Readonly<Record<string, PlatformExecutableEsiOperationDefinition>>,
) {
  assertRegisteredEsiOperation(operationId)
  const definition = getInstalledResourceEsiOperationDefinition(operationId, definitions)
  try {
    assertEsiExecutableDefinition(operationId, definition)
  } catch {
    throw new Error(
      `Installed resource ${resource.moduleId}/${resource.resourceId} operation ${operationId} does not match its executable definition`,
    )
  }
}

function assertBatchFunctions(
  resource: PlatformInstalledResourceDescriptor,
  batch: PlatformResourceBatchOperationImplementation,
) {
  if (typeof batch.request !== 'function' || typeof batch.classify !== 'function')
    throw new Error(
      `Installed resource ${resource.moduleId}/${resource.resourceId} batch implementation must provide request and classify functions`,
    )
}
