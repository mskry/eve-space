import type {
  PlatformInstalledResourceDescriptor,
  PlatformResourceBatchOperationImplementation,
  PlatformResourceOperationImplementation,
} from '@eve-space/platform-module-contract'
import type { PlatformExecutableEsiOperationDefinition } from '@eve-space/platform-module-server'
import { operationRegistry } from '@evespace/esi-client/operations'
import {
  assertExecutableEsiOperationDefinitions,
  assertRegisteredEsiOperation,
  getEsiOperationContract,
  getExecutableEsiOperationDefinition,
} from '../esi-resilience/catalog-access.js'
import { coreEsiOperationCatalog } from '../esi-resilience/catalog.js'
import { installedModuleEsiOperationDefinitions } from '../generated/platform/installed-module-esi.js'
import { platformResources } from './resources.js'

const coreResourceEsiOperationCatalog = {
  'alliance-corporations': coreEsiOperationCatalog['alliance-corporations'],
  'corporation-members': coreEsiOperationCatalog['corporation-members'],
} as const

const coreResourceEsiOperationDefinitions = {
  'alliance-corporations': {
    sdkOperationId: 'GetAlliancesAllianceIdCorporations',
    descriptor: operationRegistry.GetAlliancesAllianceIdCorporations!,
    contract: coreResourceEsiOperationCatalog['alliance-corporations'],
  },
  'corporation-members': {
    sdkOperationId: 'GetCorporationsCorporationIdMembers',
    descriptor: operationRegistry.GetCorporationsCorporationIdMembers!,
    contract: coreResourceEsiOperationCatalog['corporation-members'],
  },
} as const satisfies Readonly<Record<string, PlatformExecutableEsiOperationDefinition>>

const resourceEsiOperationDefinitions = {
  ...coreResourceEsiOperationDefinitions,
  ...installedModuleEsiOperationDefinitions,
}

export function assertInstalledResourceDeclarations(
  resources: readonly PlatformInstalledResourceDescriptor[] = platformResources,
  definitions?: Readonly<Record<string, PlatformExecutableEsiOperationDefinition>>,
) {
  if (!definitions)
    assertExecutableEsiOperationDefinitions(
      coreResourceEsiOperationCatalog,
      coreResourceEsiOperationDefinitions,
    )
  for (const resource of resources) {
    assertRegisteredEsiOperation(resource.operationId)
    assertResourceDefinition(resource, resource.operationId, definitions)
    const primary = getEsiOperationContract(resource.operationId)
    if (resource.subjectKind === 'deployment' && primary.authorization.kind !== 'public')
      throw new Error('Deployment resources require public operations')
    for (const operationId of resource.dependentOperationIds ?? []) {
      assertResourceDefinition(resource, operationId, definitions)
      assertRegisteredEsiOperation(operationId)
      const dependent = getEsiOperationContract(operationId)
      if (
        dependent.authorization.kind !== primary.authorization.kind ||
        (dependent.authorization.kind === 'character' &&
          primary.authorization.kind === 'character' &&
          dependent.authorization.scope !== primary.authorization.scope)
      )
        throw new Error('Dependent operations must retain the resource authorization contract')
    }
    assertResourceImplementation(resource, resource.implementation)
    assertResourceBatchImplementation(resource, resource.implementation, definitions)
  }
}

export function getInstalledResourceEsiOperationDefinition(
  operationId: string,
  definitions: Readonly<
    Record<string, PlatformExecutableEsiOperationDefinition>
  > = resourceEsiOperationDefinitions,
) {
  return getExecutableEsiOperationDefinition(operationId, definitions)
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
  const contract = getEsiOperationContract(descriptor.operationId)
  if (contract.authorization.kind !== 'public')
    throw new Error(
      `Installed resource ${resource.moduleId}/${resource.resourceId} batch operation ${descriptor.operationId} must use public authorization`,
    )
  if (contract.identity.kind !== 'set')
    throw new Error(
      `Installed resource ${resource.moduleId}/${resource.resourceId} batch operation ${descriptor.operationId} must use set identity`,
    )
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
  const contract = getEsiOperationContract(operationId)
  if (
    definition.contract.audit.esiOperationId !== contract.audit.esiOperationId ||
    definition.contract.authorization.kind !== contract.authorization.kind
  )
    throw new Error(
      `Installed resource ${resource.moduleId}/${resource.resourceId} operation ${operationId} does not match its executable definition`,
    )
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
