import type { PlatformEsiOperationContract } from '@eve-space/platform-module-contract'
import type { PlatformExecutableEsiOperationDefinition } from '@eve-space/platform-module-server'
import { operationRegistry } from '@evespace/esi-client/operations'
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
export { coreEsiOperationIds } from './internal/operation-metadata.js'

export type EsiOperationAuthorization =
  | { readonly kind: 'public' }
  | { readonly kind: 'character'; readonly requiredScope: string }

export interface EsiSetOperationConfiguration {
  readonly field: string
  readonly maximumItems: number
}

const corePlatformEsiOperationDefinitions = {
  'alliance-corporations': {
    sdkOperationId: 'GetAlliancesAllianceIdCorporations',
    descriptor: operationRegistry.GetAlliancesAllianceIdCorporations!,
    contract: esiOperationCatalog['alliance-corporations'],
  },
  'corporation-members': {
    sdkOperationId: 'GetCorporationsCorporationIdMembers',
    descriptor: operationRegistry.GetCorporationsCorporationIdMembers!,
    contract: esiOperationCatalog['corporation-members'],
  },
} as const satisfies Readonly<Record<string, PlatformExecutableEsiOperationDefinition>>

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

type PlatformEsiOperation = keyof typeof platformEsiOperationDefinitions

export function assertEsiCatalogConfiguration(options: {
  readonly compatibilityDate: string
  readonly ssoEnabled: boolean
  readonly requestableScopes: readonly string[]
}): void {
  assertEsiOperationCatalogConfiguration(options)
  assertEsiPlatformExecutionConfiguration()
}

export function assertRegisteredEsiOperation(operation: string): asserts operation is EsiOperation {
  if (!Object.hasOwn(esiOperationCatalog, operation))
    throw new Error(`Unregistered ESI operation: ${operation}`)
}

export function getEsiOperationAuthorization(operation: EsiOperation): EsiOperationAuthorization {
  const authorization = esiOperationCatalog[operation].authorization
  return authorization.kind === 'public'
    ? { kind: 'public' }
    : { kind: 'character', requiredScope: authorization.scope }
}

export function getCharacterEsiScope(operation: EsiOperation) {
  const authorization = getEsiOperationAuthorization(operation)
  if (authorization.kind !== 'character')
    throw new Error(`ESI operation ${operation} does not declare character authorization`)
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
  if (identity.kind !== 'set') throw new Error(`ESI operation ${operation} is not set-like`)
  return { field: identity.field, maximumItems: identity.maximumItems }
}

export function getEsiMaximumBatchSize(operation: CoreEsiOperation) {
  return getGeneratedEsiMaximumBatchSize(operation)
}

export function assertPlatformEsiOperation(
  operation: string,
): asserts operation is PlatformEsiOperation {
  assertRegisteredEsiOperation(operation)
  if (!Object.hasOwn(platformEsiOperationDefinitions, operation))
    throw new Error(`ESI operation ${operation} is not registered for platform execution`)
}

export function assertCoreEsiOperation(operation: EsiOperation): void {
  if (Object.hasOwn(platformEsiOperationDefinitions, operation))
    throw new Error(`ESI operation ${operation} is registered for platform execution`)
}

export function getPlatformEsiOperationDefinition(operation: string) {
  assertPlatformEsiOperation(operation)
  return platformEsiOperationDefinitions[operation]
}

/** Verifies that every catalog operation has exactly one callable or platform execution path. */
export function assertEsiPlatformExecutionConfiguration(): void {
  const duplicateOperations = Object.keys(corePlatformEsiOperationDefinitions).filter((operation) =>
    Object.hasOwn(installedModuleEsiOperationDefinitions, operation),
  )
  if (duplicateOperations.length > 0)
    throw new Error(
      `ESI operations select duplicate platform execution paths: ${duplicateOperations
        .toSorted((left, right) => left.localeCompare(right))
        .join(', ')}`,
    )
  assertExecutableEsiOperationDefinitions(
    platformEsiOperationCatalog,
    platformEsiOperationDefinitions,
  )

  const issues: string[] = []
  for (const operation of Object.keys(esiOperationCatalog)) {
    const platform = Object.hasOwn(platformEsiOperationDefinitions, operation)
    if (!platform && !Object.hasOwn(esiOperationMetadata, operation))
      issues.push(`operation ${operation} has no core callable execution path`)
  }
  if (issues.length > 0)
    throw new Error(
      `Invalid ESI execution path selection:\n${issues
        .toSorted((left, right) => left.localeCompare(right))
        .map((issue) => `- ${issue}`)
        .join('\n')}`,
    )
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
  )
    throw new Error(`ESI operation ${operation} does not match its executable definition`)
}
