import {
  resolveOperationRolePredicate,
  type PlatformEsiOperationContract,
} from '@eve-space/platform-module-contract/esi'
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

export function assertEsiOperationCatalogConfiguration<Catalog extends object>(
  options: {
    compatibilityDate: string
    ssoEnabled: boolean
    requestableScopes: readonly string[]
  },
  catalog?: Catalog,
  expectedSdkOperationIds?: Readonly<Record<string, string>>,
) {
  const registeredCatalog = catalog ?? esiOperationCatalog
  const expectedIds =
    expectedSdkOperationIds ??
    (registeredCatalog === esiOperationCatalog ? installedModuleEsiSdkOperationIds : {})
  assertEsiOperationContracts(registeredCatalog, expectedIds)
  if (registeredCatalog === esiOperationCatalog) {
    assertEsiOperationSdkClassifications(registeredCatalog)
    assertExecutableEsiOperationDefinitions(
      installedModuleEsiOperationCatalog,
      installedModuleEsiOperationDefinitions,
    )
  }
  if (!isIsoCalendarDate(options.compatibilityDate)) {
    throw new Error('ESI compatibility configuration date must use YYYY-MM-DD')
  }

  const incompatible = Object.entries(registeredCatalog).flatMap(([operation, contract]) =>
    contract.compatibility.minimumDate > options.compatibilityDate
      ? [`${operation} requires ${contract.compatibility.minimumDate}`]
      : [],
  )
  if (incompatible.length > 0) {
    throw new Error(
      `ESI compatibility configuration is too old: ${incompatible.toSorted((left, right) => left.localeCompare(right)).join(', ')}`,
    )
  }

  if (!options.ssoEnabled) {
    return
  }
  const requestableScopes = new Set(options.requestableScopes)
  const missingScopes = new Set<string>()
  for (const contract of Object.values(registeredCatalog)) {
    if (
      contract.authorization.kind === 'oauth' &&
      !requestableScopes.has(contract.authorization.scope)
    ) {
      missingScopes.add(contract.authorization.scope)
    }
  }
  if (missingScopes.size > 0) {
    throw new Error(
      `EVE_SCOPES is missing scopes required by registered ESI operations: ${[...missingScopes].toSorted((left, right) => left.localeCompare(right)).join(' ')}`,
    )
  }
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
    if (sdkOperation.classification !== expectedClassification) {
      issues.push(
        `operation ${operation} is configured as ${expectedClassification} but SDK operation ${contract.audit.esiOperationId} is ${sdkOperation.classification}`,
      )
    }
  }
  if (issues.length > 0) {
    throw new Error(
      `Invalid ESI SDK operation classifications:\n${issues
        .toSorted((left, right) => left.localeCompare(right))
        .map((issue) => `- ${issue}`)
        .join('\n')}`,
    )
  }
}

const validateGeneratedOperationAuthority = (
  operation: string,
  contract: PlatformEsiOperationContract,
  definition: PlatformExecutableEsiOperationDefinition,
): string[] => {
  const issues: string[] = []
  const transport = definition.descriptor.transport
  const authorization = contract.authorization
  if (authorization.kind === 'public') {
    if (transport.authentication !== null || transport.requiredRoles.length > 0) {
      issues.push(`operation ${operation} has inconsistent public SDK authority`)
    }
  } else if (
    transport.authentication?.scopes.length !== 1 ||
    transport.authentication.scopes[0] !== authorization.scope ||
    resolveOperationRolePredicate(transport.requiredRoles) !== authorization.requiredRolePredicate
  ) {
    issues.push(`operation ${operation} does not match generated OAuth authority`)
  }
  if (
    JSON.stringify(authorization.subjectBindings) !==
    JSON.stringify(transport.requestSubjectBindings)
  ) {
    issues.push(`operation ${operation} does not match generated request subjects`)
  }
  return issues
}

const validateExecutableDefinition = (
  operation: string,
  contract: PlatformEsiOperationContract,
  definition: PlatformExecutableEsiOperationDefinition,
): string[] => {
  const issues: string[] = []
  if (definition.contract !== contract) {
    issues.push(`operation ${operation} definition does not own its catalog contract`)
  }
  if (definition.sdkOperationId !== contract.audit.esiOperationId) {
    issues.push(
      `operation ${operation} definition binds ${definition.sdkOperationId} instead of ${contract.audit.esiOperationId}`,
    )
  }
  if (operationRegistry[definition.sdkOperationId] !== definition.descriptor) {
    issues.push(`operation ${operation} does not bind the registered SDK descriptor`)
  }
  issues.push(...validateGeneratedOperationAuthority(operation, contract, definition))
  return issues
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
    issues.push(...validateExecutableDefinition(operation, contract, definition))
  }
  if (issues.length > 0) {
    throw new Error(
      `Invalid executable ESI operation definitions:\n${issues
        .toSorted((left, right) => left.localeCompare(right))
        .map((issue) => `- ${issue}`)
        .join('\n')}`,
    )
  }
}
