import type { PlatformEsiOperationContract } from '@eve-space/platform-module-contract'
import type { PlatformExecutableEsiOperationDefinition } from '@eve-space/platform-module-server'
import { operationRegistry } from '@evespace/esi-client/operations'
import {
  installedModuleEsiOperationCatalog,
  installedModuleEsiOperationDefinitions,
  installedModuleEsiSdkOperationIds,
} from '../../generated/platform/installed-module-esi.js'
import { assertEsiOperationContracts, isIsoCalendarDate } from './catalog-validation.js'
import { esiOperationCatalog, type EsiOperation } from './catalog.js'
import type { EsiOperationContract } from './contract-types.js'

export function getEsiOperationContract<Operation extends EsiOperation>(operation: Operation) {
  return esiOperationCatalog[operation]
}

/** The floating-window rate-limit group an operation declares, or undefined when it is legacy-only. */
export function getDeclaredEsiRateLimit(contract: EsiOperationContract) {
  return contract.rateGroup.kind === 'declared' ? contract.rateGroup : undefined
}

export function assertEsiOperationCatalogConfiguration(
  options: {
    compatibilityDate: string
    ssoEnabled: boolean
    requestableScopes: readonly string[]
  },
  catalog: Readonly<Record<string, unknown>> = esiOperationCatalog,
  expectedSdkOperationIds: Readonly<Record<string, string>> = catalog === esiOperationCatalog
    ? installedModuleEsiSdkOperationIds
    : {},
) {
  assertEsiOperationContracts(catalog, expectedSdkOperationIds)
  if (catalog === esiOperationCatalog) {
    assertEsiOperationSdkClassifications(catalog)
    assertExecutableEsiOperationDefinitions(
      installedModuleEsiOperationCatalog,
      installedModuleEsiOperationDefinitions,
    )
  }
  if (!isIsoCalendarDate(options.compatibilityDate))
    throw new Error('ESI compatibility configuration date must use YYYY-MM-DD')

  const incompatible = Object.entries(catalog).flatMap(([operation, contract]) =>
    contract.compatibility.minimumDate > options.compatibilityDate
      ? [`${operation} requires ${contract.compatibility.minimumDate}`]
      : [],
  )
  if (incompatible.length > 0)
    throw new Error(
      `ESI compatibility configuration is too old: ${incompatible.toSorted((left, right) => left.localeCompare(right)).join(', ')}`,
    )

  if (!options.ssoEnabled) return
  const requestableScopes = new Set(options.requestableScopes)
  const missingScopes = new Set<string>()
  for (const contract of Object.values(catalog)) {
    if (
      contract.authorization.kind === 'character' &&
      !requestableScopes.has(contract.authorization.scope)
    )
      missingScopes.add(contract.authorization.scope)
  }
  if (missingScopes.size > 0)
    throw new Error(
      `EVE_SCOPES is missing scopes required by registered ESI operations: ${[...missingScopes].toSorted((left, right) => left.localeCompare(right)).join(' ')}`,
    )
}

export function assertEsiOperationSdkClassifications(
  catalog: Readonly<Record<string, EsiOperationContract>>,
  registry: Readonly<
    Record<string, { readonly classification: 'read' | 'mutation' } | undefined>
  > = operationRegistry,
) {
  const issues: string[] = []
  for (const [operation, contract] of Object.entries(catalog)) {
    const sdkOperation = registry[contract.audit.esiOperationId]
    if (!sdkOperation) {
      issues.push(
        `operation ${operation} references missing SDK operation ${contract.audit.esiOperationId}`,
      )
      continue
    }
    const expectedClassification = contract.mutation ? 'mutation' : 'read'
    if (sdkOperation.classification !== expectedClassification)
      issues.push(
        `operation ${operation} is configured as ${expectedClassification} but SDK operation ${contract.audit.esiOperationId} is ${sdkOperation.classification}`,
      )
  }
  if (issues.length > 0)
    throw new Error(
      `Invalid ESI SDK operation classifications:\n${issues
        .toSorted((left, right) => left.localeCompare(right))
        .map((issue) => `- ${issue}`)
        .join('\n')}`,
    )
}

export function assertExecutableEsiOperationDefinitions(
  catalog: Readonly<Record<string, PlatformEsiOperationContract>>,
  definitions: Readonly<Record<string, PlatformExecutableEsiOperationDefinition>>,
) {
  const issues: string[] = []
  const operationIds = new Set([...Object.keys(catalog), ...Object.keys(definitions)])
  for (const operation of operationIds) {
    const contract = catalog[operation]
    const definition = definitions[operation]
    if (!contract) {
      issues.push(`definition ${operation} has no catalog contract`)
      continue
    }
    if (!definition) {
      issues.push(`catalog operation ${operation} has no executable definition`)
      continue
    }
    if (definition.contract !== contract)
      issues.push(`operation ${operation} definition does not own its catalog contract`)
    if (definition.sdkOperationId !== contract.audit.esiOperationId)
      issues.push(
        `operation ${operation} definition binds ${definition.sdkOperationId} instead of ${contract.audit.esiOperationId}`,
      )
    if (operationRegistry[definition.sdkOperationId] !== definition.descriptor)
      issues.push(`operation ${operation} does not bind the registered SDK descriptor`)
  }
  if (issues.length > 0)
    throw new Error(
      `Invalid executable ESI operation definitions:\n${issues
        .toSorted((left, right) => left.localeCompare(right))
        .map((issue) => `- ${issue}`)
        .join('\n')}`,
    )
}
