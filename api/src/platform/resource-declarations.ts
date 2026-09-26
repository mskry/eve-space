import {
  platformResourceExecutionModes,
  type PlatformInstalledResourceDescriptor,
  type PlatformResourceBatchOperationImplementation,
  type PlatformResourceExecutionMode,
  type PlatformResourceImplementation,
} from '@eve-space/platform-module-contract/resources'
import type { PlatformExecutableEsiOperationDefinition } from '@eve-space/platform-module-server'
import { assertCoreDataProductDeclarations } from '../core-data/capabilities.js'
import {
  assertEsiPlatformExecutionConfiguration,
  assertEsiExecutableDefinition,
  assertRegisteredEsiOperation,
  getEsiOperationAuthorization,
  getEsiSetOperationConfiguration,
  getPlatformEsiOperationDefinition,
} from '../esi-gateway/catalog-interface.js'
import { isRecord } from '../type-guards.js'
import { platformResources } from './resources.js'

const resourceExecutionModes: ReadonlySet<string> = new Set(platformResourceExecutionModes)

const resourceModeMethods = {
  'bounded-collection': { forbidden: ['request', 'map'], required: ['collect'] },
  'single-request': { forbidden: ['collect'], required: ['request', 'map'] },
} as const satisfies Record<
  PlatformResourceExecutionMode,
  { readonly required: readonly string[]; readonly forbidden: readonly string[] }
>

export function assertInstalledResourceDeclarations(
  resources: readonly PlatformInstalledResourceDescriptor[] = platformResources,
  definitions?: Readonly<Record<string, PlatformExecutableEsiOperationDefinition>>,
) {
  if (!definitions) {
    assertEsiPlatformExecutionConfiguration()
  }
  for (const resource of resources) {
    assertCoreDataProductDeclarations(resource.coreDataProducts ?? [], 'resource-projection')
    assertRegisteredEsiOperation(resource.operationId)
    assertResourceDefinition(resource, resource.operationId, definitions)
    const primary = getEsiOperationAuthorization(resource.operationId)
    if (resource.subjectKind === 'deployment' && primary.kind !== 'public') {
      throw new Error('Deployment resources require public operations')
    }
    for (const operationId of resource.dependentOperationIds ?? []) {
      assertResourceDefinition(resource, operationId, definitions)
      assertRegisteredEsiOperation(operationId)
      const dependent = getEsiOperationAuthorization(operationId)
      if (dependent.kind === 'character' && primary.kind !== 'character') {
        throw new Error('Dependent operations must retain the resource authorization contract')
      }
      if (
        dependent.kind === 'character' &&
        primary.kind === 'character' &&
        dependent.requiredScope !== primary.requiredScope
      ) {
        throw new Error('Dependent operations must retain the resource authorization contract')
      }
    }
    assertResourceImplementation(resource, resource.implementation)
    assertResourceBatchImplementation(resource, resource.implementation, definitions)
  }
}

function getInstalledResourceEsiOperationDefinition(
  operationId: string,
  definitions?: Readonly<Record<string, PlatformExecutableEsiOperationDefinition>>,
) {
  if (!definitions) {
    return getPlatformEsiOperationDefinition(operationId)
  }
  const definition = definitions[operationId]
  if (!definition) {
    throw new Error(`ESI operation ${operationId} has no executable definition`)
  }
  return definition
}

function assertResourceImplementation(
  resource: PlatformInstalledResourceDescriptor,
  implementation: unknown,
): asserts implementation is PlatformResourceImplementation {
  const label = `Installed resource ${resource.moduleId}/${resource.resourceId}`
  if (!isRecord(implementation) || !isResourceExecutionMode(implementation.mode)) {
    throw new Error(`${label} must declare a single-request or bounded-collection execution mode`)
  }
  const methods = resourceModeMethods[implementation.mode]
  if (
    typeof implementation.operation !== 'string' ||
    typeof implementation.materialize !== 'function' ||
    methods.required.some((method) => typeof implementation[method] !== 'function')
  ) {
    throw new Error(
      `${label} must provide operation, materialize, and ${methods.required.join(' and ')} for ${implementation.mode} execution`,
    )
  }
  const forbidden = methods.forbidden.filter((method) => implementation[method] !== undefined)
  if (forbidden.length > 0) {
    throw new Error(
      `${label} ${implementation.mode} execution cannot provide ${forbidden.join(' or ')}`,
    )
  }
  if (implementation.mode === 'single-request' && resource.dependentOperationIds?.length) {
    throw new Error(`${label} single-request execution cannot declare dependent operations`)
  }
  if (implementation.operation !== resource.operationId) {
    throw new Error(
      `${label} implements ${implementation.operation} instead of ${resource.operationId}`,
    )
  }
}

function assertResourceBatchImplementation(
  resource: PlatformInstalledResourceDescriptor,
  implementation: PlatformResourceImplementation,
  definitions?: Readonly<Record<string, PlatformExecutableEsiOperationDefinition>>,
) {
  const descriptor = resource.batch
  const batch = implementation.batch
  if (!descriptor && !batch) {
    return
  }
  if (!descriptor || !batch) {
    throw new Error(
      `Installed resource ${resource.moduleId}/${resource.resourceId} must declare matching batch descriptor and implementation`,
    )
  }

  assertRegisteredEsiOperation(descriptor.operationId)
  assertResourceDefinition(resource, descriptor.operationId, definitions)
  if (getEsiOperationAuthorization(descriptor.operationId).kind !== 'public') {
    throw new Error(
      `Installed resource ${resource.moduleId}/${resource.resourceId} batch operation ${descriptor.operationId} must use public authorization`,
    )
  }
  try {
    getEsiSetOperationConfiguration(descriptor.operationId)
  } catch {
    throw new Error(
      `Installed resource ${resource.moduleId}/${resource.resourceId} batch operation ${descriptor.operationId} must use set identity`,
    )
  }
  assertBatchFunctions(resource, batch)
  if (batch.mode !== descriptor.mode) {
    throw new Error(
      `Installed resource ${resource.moduleId}/${resource.resourceId} implements batch mode ${batch.mode} instead of ${descriptor.mode}`,
    )
  }
  if (batch.operation !== descriptor.operationId) {
    throw new Error(
      `Installed resource ${resource.moduleId}/${resource.resourceId} implements batch operation ${batch.operation} instead of ${descriptor.operationId}`,
    )
  }
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
  if (typeof batch.request !== 'function' || typeof batch.classify !== 'function') {
    throw new TypeError(
      `Installed resource ${resource.moduleId}/${resource.resourceId} batch implementation must provide request and classify functions`,
    )
  }
}

function isResourceExecutionMode(mode: unknown): mode is PlatformResourceExecutionMode {
  return typeof mode === 'string' && resourceExecutionModes.has(mode)
}
