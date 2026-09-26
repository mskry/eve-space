import { createHash } from 'node:crypto'
import {
  platformResourceExecutionModes,
  type PlatformInstalledResourceDescriptor,
  type PlatformResourceBatchOperationImplementation,
  type PlatformResourceExecutionMode,
  type PlatformResourceImplementation,
} from '@eve-space/platform-module-contract/resources'
import type { PlatformExecutableEsiOperationDefinition } from '@eve-space/platform-module-server'
import type {
  PlatformEsiAuthorizationContract,
  PlatformEsiRequestSubject,
  PlatformEsiRolePredicate,
} from '@eve-space/platform-module-contract/esi'
import { assertCoreDataProductDeclarations } from '../core-data/capabilities.js'
import {
  assertEsiPlatformExecutionConfiguration,
  assertEsiExecutableDefinition,
  assertRegisteredEsiOperation,
  getEsiOperationAuthorization,
  getEsiOperationAuthority,
  getEsiSetOperationConfiguration,
  getPlatformEsiOperationDefinition,
} from '../esi-gateway/catalog-interface.js'
import { isRecord } from '../type-guards.js'
import { platformResources } from './resources.js'

const resourceExecutionModes: ReadonlySet<string> = new Set(platformResourceExecutionModes)

export type PlatformResourceCredentialBinding =
  | { readonly kind: 'public' }
  | {
      readonly kind: 'current-owned-character' | 'current-managed-member-character'
      readonly requestSubjects: readonly PlatformEsiRequestSubject[]
      readonly scope: string
      readonly sectionId?: string
      readonly corporationInput: 'current-affiliation' | null
    }
  | {
      readonly kind: 'current-managed-corporation-source'
      readonly requestSubjects: readonly ['corporation_id']
      readonly scope: string
      readonly requiredRolePredicate: PlatformEsiRolePredicate | null
    }

export interface PlatformCorporationResourceRequirements {
  readonly scopes: readonly string[]
  readonly rolePredicates: readonly PlatformEsiRolePredicate[]
  readonly fingerprint: string
}

const resourceModeMethods = {
  'bounded-collection': { forbidden: ['request', 'map'], required: ['collect'] },
  'single-request': { forbidden: ['collect'], required: ['request', 'map'] },
} as const satisfies Record<
  PlatformResourceExecutionMode,
  { readonly required: readonly string[]; readonly forbidden: readonly string[] }
>

const assertResourceOperationAuthorities = (
  resource: PlatformInstalledResourceDescriptor,
  definitions?: Readonly<Record<string, PlatformExecutableEsiOperationDefinition>>,
) => {
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
    const authorityChanged = dependent.kind === 'oauth' && primary.kind !== 'oauth'
    const scopeChanged =
      dependent.kind === 'oauth' &&
      primary.kind === 'oauth' &&
      dependent.requiredScope !== primary.requiredScope &&
      resource.eligibility.kind !== 'current-managed-corporation-source'
    if (authorityChanged || scopeChanged) {
      throw new Error('Dependent operations must retain the resource authorization contract')
    }
  }
  getInstalledResourceCredentialBindings(resource)
  if (resource.eligibility.kind === 'current-managed-corporation-source') {
    getManagedCorporationResourceRequirements(resource)
  }
}

export function assertInstalledResourceDeclarations(
  resources: readonly PlatformInstalledResourceDescriptor[] = platformResources,
  definitions?: Readonly<Record<string, PlatformExecutableEsiOperationDefinition>>,
) {
  if (!definitions) {
    assertEsiPlatformExecutionConfiguration()
  }
  for (const resource of resources) {
    assertCoreDataProductDeclarations(resource.coreDataProducts ?? [], 'resource-projection')
    assertResourceOperationAuthorities(resource, definitions)
    assertResourceImplementation(resource, resource.implementation)
    assertResourceBatchImplementation(resource, resource.implementation, definitions)
  }
}

export const getInstalledResourceCredentialBindings = (
  resource: PlatformInstalledResourceDescriptor,
): Readonly<Record<string, PlatformResourceCredentialBinding>> => {
  for (const key of [
    'authorization',
    'scope',
    'requiredRolePredicate',
    'subjectBindings',
    'credentialBinding',
  ]) {
    if (Object.hasOwn(resource, key) || Object.hasOwn(resource.eligibility, key)) {
      throw new Error(
        `Resource ${resource.resourceId} cannot override generated operation authority`,
      )
    }
  }
  const bindings: Record<string, PlatformResourceCredentialBinding> = {}
  for (const operationId of [resource.operationId, ...(resource.dependentOperationIds ?? [])]) {
    assertRegisteredEsiOperation(operationId)
    bindings[operationId] = compileResourceCredentialBinding(
      resource,
      getEsiOperationAuthority(operationId),
    )
  }
  return Object.freeze(bindings)
}

export const getManagedCorporationResourceRequirements = (
  resource: PlatformInstalledResourceDescriptor,
): PlatformCorporationResourceRequirements => {
  if (resource.eligibility.kind !== 'current-managed-corporation-source') {
    throw new Error(`Resource ${resource.resourceId} is not a managed-corporation resource`)
  }
  const bindings = Object.values(getInstalledResourceCredentialBindings(resource))
  const scopes = [
    ...new Set(
      bindings.map((binding) => {
        if (binding.kind !== 'current-managed-corporation-source') {
          throw new Error(
            `Resource ${resource.resourceId} cannot mix corporation credentials with public operations`,
          )
        }
        return binding.scope
      }),
    ),
  ].toSorted((left, right) => left.localeCompare(right))
  const rolePredicates = [
    ...new Set(
      bindings.flatMap((binding) =>
        binding.kind === 'current-managed-corporation-source' && binding.requiredRolePredicate
          ? [binding.requiredRolePredicate]
          : [],
      ),
    ),
  ].toSorted((left, right) => left.localeCompare(right))
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ version: 1, scopes, rolePredicates }))
    .digest('hex')
  return Object.freeze({ scopes, rolePredicates, fingerprint })
}

const compileResourceCredentialBinding = (
  resource: PlatformInstalledResourceDescriptor,
  authority: PlatformEsiAuthorizationContract,
): PlatformResourceCredentialBinding => {
  if (authority.kind === 'public') {
    return { kind: 'public' }
  }
  const subjects = authority.subjectBindings
  const kind = resource.eligibility.kind
  if (kind === 'current-managed-corporation-source') {
    if (
      resource.subjectKind !== 'corporation' ||
      subjects.length !== 1 ||
      subjects[0] !== 'corporation_id'
    ) {
      throw new Error(
        `Resource ${resource.resourceId} must bind its corporation request to its current source`,
      )
    }
    return {
      kind: 'current-managed-corporation-source',
      requestSubjects: ['corporation_id'],
      requiredRolePredicate: authority.requiredRolePredicate,
      scope: authority.scope,
    }
  }
  if (
    resource.subjectKind !== 'character' ||
    (kind !== 'current-owned-character' && kind !== 'current-managed-member-character') ||
    subjects.length === 0 ||
    subjects.some((subject) => subject !== 'character_id' && subject !== 'corporation_id') ||
    authority.requiredRolePredicate !== null
  ) {
    throw new Error(
      `Resource ${resource.resourceId} has incompatible character credential authority`,
    )
  }
  return {
    kind,
    requestSubjects: subjects,
    scope: authority.scope,
    corporationInput: subjects.includes('corporation_id') ? 'current-affiliation' : null,
    ...(kind === 'current-managed-member-character' && { sectionId: resource.sectionId }),
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
