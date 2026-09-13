import { CORE_DATA_PRODUCT_IDS, type CoreDataProductId } from '@eve-space/core-data-contract'
import {
  coreDataCoverageExposures,
  coreDataCoverageManifest,
  coreDataCoverageSources,
  coreDataCoverageStatuses,
} from './coverage-manifest.js'
import { coreDataProductCatalog } from './product-catalog.js'

export interface CoreDataCoverageAuthorities {
  esiOperationIds: readonly string[]
}

export function assertCoreDataCoverageManifest(
  authorities: CoreDataCoverageAuthorities,
  manifest: readonly unknown[] = coreDataCoverageManifest,
  executableProductIds: readonly string[] = coreDataProductCatalog.map(({ id }) => id),
): void {
  const issues: string[] = []
  const entryKeys = new Set<string>()
  const manifestedProducts = new Map<string, number>()
  const validEsiOperations = new Set(authorities.esiOperationIds)

  validateManifestEntries(manifest, entryKeys, manifestedProducts, validEsiOperations, issues)

  const executableCounts = countValues(executableProductIds)
  validateRequiredProducts(manifestedProducts, executableCounts, issues)
  validateExecutableProducts(executableCounts, manifestedProducts, issues)
  throwForCoverageIssues(issues)
}

function validateManifestEntries(
  manifest: readonly unknown[],
  entryKeys: Set<string>,
  manifestedProducts: Map<string, number>,
  validEsiOperations: Set<string>,
  issues: string[],
): void {
  for (const candidate of manifest) {
    if (!isRecord(candidate)) {
      issues.push('coverage entry must be an object')
      continue
    }
    validateManifestEntry(candidate, entryKeys, manifestedProducts, validEsiOperations, issues)
  }
}

function validateManifestEntry(
  candidate: Record<string, unknown>,
  entryKeys: Set<string>,
  manifestedProducts: Map<string, number>,
  validEsiOperations: Set<string>,
  issues: string[],
): void {
  const domain = requiredText(candidate.domain)
  const capability = requiredText(candidate.capability)
  const owner = requiredText(candidate.owner)
  const key = `${domain ?? '?'}/${capability ?? '?'}`
  validateEntryIdentity(domain, capability, owner, key, entryKeys, issues)

  const status = candidate.status
  const exposure = candidate.exposure
  validateEntryMetadata(candidate, key, status, exposure, issues)

  const productId = candidate.productId
  recordManifestedProduct(productId, key, manifestedProducts, issues)
  validateProductExposure(productId, key, status, exposure, issues)
  validateEsiOperationLinks(candidate.esiOperationIds, key, validEsiOperations, issues)
}

function validateEntryIdentity(
  domain: string | undefined,
  capability: string | undefined,
  owner: string | undefined,
  key: string,
  entryKeys: Set<string>,
  issues: string[],
): void {
  reportIssueWhen(!domain, `${key} is missing a domain`, issues)
  reportIssueWhen(!capability, `${key} is missing a capability`, issues)
  reportIssueWhen(!owner, `${key} is missing an owner`, issues)
  reportIssueWhen(entryKeys.has(key), `${key} has duplicate ownership entries`, issues)
  entryKeys.add(key)
}

function validateEntryMetadata(
  candidate: Record<string, unknown>,
  key: string,
  status: unknown,
  exposure: unknown,
  issues: string[],
): void {
  reportIssueWhen(!includes(coreDataCoverageStatuses, status), `${key} has invalid status`, issues)
  reportIssueWhen(
    exposure !== undefined && !includes(coreDataCoverageExposures, exposure),
    `${key} has invalid exposure`,
    issues,
  )
  reportIssueWhen(!requiredText(candidate.rationale), `${key} is missing a rationale`, issues)
  reportIssueWhen(
    !includes(coreDataCoverageSources, candidate.source),
    `${key} has invalid source`,
    issues,
  )
}

function recordManifestedProduct(
  productId: unknown,
  key: string,
  manifestedProducts: Map<string, number>,
  issues: string[],
): void {
  if (productId === undefined) return
  if (typeof productId !== 'string') {
    issues.push(`${key} has invalid product identifier`)
    return
  }
  if (!isCoreDataProductId(productId)) {
    issues.push(`${key} references unknown product ${productId}`)
    return
  }
  manifestedProducts.set(productId, (manifestedProducts.get(productId) ?? 0) + 1)
}

function validateProductExposure(
  productId: unknown,
  key: string,
  status: unknown,
  exposure: unknown,
  issues: string[],
): void {
  reportIssueWhen(
    productId !== undefined && (status !== 'implemented' || exposure !== 'module-product'),
    `${key} binds a product without implemented module-product exposure`,
    issues,
  )
  reportIssueWhen(
    exposure === 'module-product' && productId === undefined,
    `${key} is missing its module-product binding`,
    issues,
  )
  reportIssueWhen(
    status === 'implemented' && exposure === undefined,
    `${key} is implemented without an exposure`,
    issues,
  )
  reportIssueWhen(
    status !== 'implemented' && exposure !== undefined,
    `${key} is non-implemented but declares an exposure`,
    issues,
  )
}

function validateEsiOperationLinks(
  esiOperationIds: unknown,
  key: string,
  validEsiOperations: Set<string>,
  issues: string[],
): void {
  if (esiOperationIds === undefined) return
  if (!Array.isArray(esiOperationIds)) {
    issues.push(`${key} has invalid ESI operation links`)
    return
  }
  for (const operation of esiOperationIds) {
    if (typeof operation !== 'string') {
      issues.push(`${key} has invalid ESI operation identifier`)
      continue
    }
    if (!validEsiOperations.has(operation))
      issues.push(`${key} references stale ESI operation ${operation}`)
  }
}

function validateRequiredProducts(
  manifestedProducts: Map<string, number>,
  executableCounts: Map<string, number>,
  issues: string[],
): void {
  for (const productId of CORE_DATA_PRODUCT_IDS) {
    if (manifestedProducts.get(productId) !== 1)
      issues.push(`product ${productId} must have exactly one coverage entry`)
    if (executableCounts.get(productId) !== 1)
      issues.push(`product ${productId} must have exactly one executable adapter`)
  }
}

function validateExecutableProducts(
  executableCounts: Map<string, number>,
  manifestedProducts: Map<string, number>,
  issues: string[],
): void {
  for (const productId of executableCounts.keys()) {
    if (!isCoreDataProductId(productId)) issues.push(`unknown executable product ${productId}`)
    else if (!manifestedProducts.has(productId))
      issues.push(`executable product ${productId} is missing coverage`)
  }
}

function throwForCoverageIssues(issues: string[]): void {
  if (issues.length > 0)
    throw new Error(
      `Invalid core-data coverage manifest:\n${issues
        .toSorted((left, right) => left.localeCompare(right))
        .map((issue) => `- ${issue}`)
        .join('\n')}`,
    )
}

function reportIssueWhen(condition: boolean, issue: string, issues: string[]): void {
  if (condition) issues.push(issue)
}

function countValues(values: readonly string[]) {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return counts
}

function requiredText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function includes<const Values extends readonly string[]>(
  values: Values,
  candidate: unknown,
): candidate is Values[number] {
  return typeof candidate === 'string' && values.includes(candidate)
}

function isCoreDataProductId(value: string): value is CoreDataProductId {
  return (CORE_DATA_PRODUCT_IDS as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
