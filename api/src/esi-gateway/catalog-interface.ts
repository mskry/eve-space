import {
  platformCoreEsiOperationSdkIdentities,
  type PlatformCoreEsiOperationId,
  type PlatformEsiOperationContract,
} from '@eve-space/platform-module-contract/esi'
import type {
  PlatformExecutableEsiOperationDefinition,
  PlatformExecutableEsiOperationProtocol,
} from '@eve-space/platform-module-server'
import { operationRegistry } from '@evespace/esi-client/operations'
import { isRecord } from '../type-guards.js'
import {
  assertEsiOperationCatalogConfiguration,
  assertExecutableEsiOperationDefinitions,
} from './internal/catalog-access.js'
import { esiOperationCatalog } from './internal/catalog.js'
import { installedModuleEsiOperationDefinitions } from '../generated/platform/installed-module-esi.js'
import {
  getGeneratedEsiMaximumBatchSize,
  esiOperationMetadata,
  type CoreEsiOperation,
} from './internal/operation-metadata.js'

export type EsiOperation = keyof typeof esiOperationCatalog
export { coreEsiOperationIds } from './catalog-authority.js'

export type EsiOperationAuthorization =
  | { readonly kind: 'public' }
  | { readonly kind: 'character'; readonly requiredScope: string }

export interface EsiSetOperationConfiguration {
  readonly field: string
  readonly maximumItems: number
}

const corePlatformEsiOperationDefinitions = {
  'alliance-corporations': coreDefinition('alliance-corporations'),
  'character-asset-names': coreDefinition('character-asset-names'),
  'character-assets-page': coreDefinition('character-assets-page'),
  'corporation-members': coreDefinition('corporation-members'),
  'mail-headers': coreDefinition('mail-headers'),
  'mail-lists': coreDefinition('mail-lists'),
  'mail-message': coreDefinition('mail-message'),
  'skill-queue': coreDefinition('skill-queue'),
  skills: coreDefinition('skills'),
  'universe-resolve-names': coreDefinition('universe-resolve-names'),
  'wallet-balance': coreDefinition('wallet-balance'),
  'wallet-journal': coreDefinition('wallet-journal'),
  'wallet-transactions': coreDefinition('wallet-transactions'),
} as const satisfies Readonly<
  Record<PlatformCoreEsiOperationId, PlatformExecutableEsiOperationDefinition>
>

const platformEsiOperationDefinitions = {
  ...corePlatformEsiOperationDefinitions,
  ...installedModuleEsiOperationDefinitions,
} as const satisfies Readonly<Record<string, PlatformExecutableEsiOperationDefinition>>

const platformEsiOperationCatalog = Object.fromEntries(
  Object.entries(platformEsiOperationDefinitions).map(([operation, definition]) => [
    operation,
    definition.contract,
  ]),
) as Readonly<Record<string, PlatformEsiOperationContract>>

type PlatformEsiOperationDefinitions = typeof platformEsiOperationDefinitions
export type PlatformEsiOperation = keyof PlatformEsiOperationDefinitions
export type PlatformEsiOperationProtocol<Operation extends PlatformEsiOperation> =
  PlatformExecutableEsiOperationProtocol<PlatformEsiOperationDefinitions, Operation>
export type PlatformEsiOperationInput<Operation extends PlatformEsiOperation> =
  PlatformEsiOperationProtocol<Operation>[Operation]['input']
export type PlatformEsiOperationOutput<Operation extends PlatformEsiOperation> =
  PlatformEsiOperationProtocol<Operation>[Operation]['output']

export function assertEsiCatalogConfiguration(options: {
  readonly compatibilityDate: string
  readonly ssoEnabled: boolean
  readonly requestableScopes: readonly string[]
}): void {
  assertEsiOperationCatalogConfiguration(options)
  assertEsiPlatformExecutionConfiguration()
}

export function assertRegisteredEsiOperation(operation: string): asserts operation is EsiOperation {
  if (!Object.hasOwn(esiOperationCatalog, operation)) {
    throw new Error(`Unregistered ESI operation: ${operation}`)
  }
}

export function getEsiOperationAuthorization(operation: EsiOperation): EsiOperationAuthorization {
  const authorization = esiOperationCatalog[operation].authorization
  return authorization.kind === 'public'
    ? { kind: 'public' }
    : { kind: 'character', requiredScope: authorization.scope }
}

export function getCharacterEsiScope(operation: EsiOperation) {
  const authorization = getEsiOperationAuthorization(operation)
  if (authorization.kind !== 'character') {
    throw new Error(`ESI operation ${operation} does not declare character authorization`)
  }
  return authorization.requiredScope
}

export function getOptionalCharacterEsiScope(operation: EsiOperation) {
  const authorization = getEsiOperationAuthorization(operation)
  return authorization.kind === 'character' ? authorization.requiredScope : null
}

export function getEsiSetOperationConfiguration(
  operation: EsiOperation,
): EsiSetOperationConfiguration {
  const identity = esiOperationCatalog[operation].identity
  if (identity.kind !== 'set') {
    throw new Error(`ESI operation ${operation} is not set-like`)
  }
  return { field: identity.field, maximumItems: identity.maximumItems }
}

export function getEsiMaximumBatchSize(operation: CoreEsiOperation) {
  return getGeneratedEsiMaximumBatchSize(operation)
}

export function assertPlatformEsiOperation(
  operation: string,
): asserts operation is PlatformEsiOperation {
  assertRegisteredEsiOperation(operation)
  if (!Object.hasOwn(platformEsiOperationDefinitions, operation)) {
    throw new Error(`ESI operation ${operation} is not registered for platform execution`)
  }
}

export function assertCoreEsiOperation(operation: EsiOperation): void {
  if (Object.hasOwn(platformEsiOperationDefinitions, operation)) {
    throw new Error(`ESI operation ${operation} is registered for platform execution`)
  }
}

export function getPlatformEsiOperationDefinition<Operation extends PlatformEsiOperation>(
  operation: Operation,
): PlatformEsiOperationDefinitions[Operation]
export function getPlatformEsiOperationDefinition(
  operation: string,
): PlatformEsiOperationDefinitions[PlatformEsiOperation]
export function getPlatformEsiOperationDefinition(operation: string) {
  assertPlatformEsiOperation(operation)
  return platformEsiOperationDefinitions[operation]
}

/** Parses untrusted inputs with the operation's SDK request schema; the only input narrowing point. */
export function parsePlatformEsiOperationInputs<Operation extends PlatformEsiOperation>(
  operation: Operation,
  inputs: unknown,
): PlatformEsiOperationInput<Operation> {
  const parsed: unknown =
    getPlatformEsiOperationDefinition(operation).descriptor.requestSchema.parse(inputs)
  if (!isRecord(parsed)) {
    throw new Error('ESI SDK operation arguments must resolve to an object')
  }
  return parsed as PlatformEsiOperationInput<Operation>
}

/** Narrows data the execution runtime validated with the operation's SDK response schema. */
export function narrowPlatformEsiOperationOutput<Operation extends PlatformEsiOperation>(
  _operation: Operation,
  data: unknown,
): PlatformEsiOperationOutput<Operation> {
  return data as PlatformEsiOperationOutput<Operation>
}

/** Verifies that every catalog operation has exactly one callable or platform execution path. */
export function assertEsiPlatformExecutionConfiguration(): void {
  const duplicateOperations = Object.keys(corePlatformEsiOperationDefinitions).filter((operation) =>
    Object.hasOwn(installedModuleEsiOperationDefinitions, operation),
  )
  assertCorePlatformEsiOperationIdentities()
  if (duplicateOperations.length > 0) {
    throw new Error(
      `ESI operations select duplicate platform execution paths: ${duplicateOperations
        .toSorted((left, right) => left.localeCompare(right))
        .join(', ')}`,
    )
  }
  assertExecutableEsiOperationDefinitions(
    platformEsiOperationCatalog,
    platformEsiOperationDefinitions,
  )

  const issues: string[] = []
  for (const operation of Object.keys(esiOperationCatalog)) {
    const platform = Object.hasOwn(platformEsiOperationDefinitions, operation)
    if (!platform && !Object.hasOwn(esiOperationMetadata, operation)) {
      issues.push(`operation ${operation} has no core callable execution path`)
    }
  }
  if (issues.length > 0) {
    throw new Error(
      `Invalid ESI execution path selection:\n${issues
        .toSorted((left, right) => left.localeCompare(right))
        .map((issue) => `- ${issue}`)
        .join('\n')}`,
    )
  }
}

export function assertEsiExecutableDefinition(operation: EsiOperation, definition: unknown): void {
  const contract = esiOperationCatalog[operation]
  if (
    typeof definition !== 'object' ||
    definition === null ||
    !('contract' in definition) ||
    typeof definition.contract !== 'object' ||
    definition.contract === null ||
    !('audit' in definition.contract) ||
    typeof definition.contract.audit !== 'object' ||
    definition.contract.audit === null ||
    !('esiOperationId' in definition.contract.audit) ||
    definition.contract.audit.esiOperationId !== contract.audit.esiOperationId ||
    !('authorization' in definition.contract) ||
    typeof definition.contract.authorization !== 'object' ||
    definition.contract.authorization === null ||
    !('kind' in definition.contract.authorization) ||
    definition.contract.authorization.kind !== contract.authorization.kind
  ) {
    throw new Error(`ESI operation ${operation} does not match its executable definition`)
  }
}

function assertCorePlatformEsiOperationIdentities() {
  const published = new Map<string, string>(Object.entries(platformCoreEsiOperationSdkIdentities))
  const definitions = Object.entries(corePlatformEsiOperationDefinitions)
  if (
    published.size !== definitions.length ||
    definitions.some(
      ([operation, definition]) => published.get(operation) !== definition.sdkOperationId,
    )
  ) {
    throw new Error('Core platform ESI definitions do not match the published SDK identities')
  }
}

function coreDefinition<const Operation extends PlatformCoreEsiOperationId>(operation: Operation) {
  const sdkOperationId = platformCoreEsiOperationSdkIdentities[operation]
  const descriptor = operationRegistry[sdkOperationId]
  if (!descriptor) {
    throw new Error(`Core ESI operation ${operation} has no SDK descriptor`)
  }
  return { contract: esiOperationCatalog[operation], descriptor, sdkOperationId } as const
}
