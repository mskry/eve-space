import {
  platformContributionIdPattern,
  platformExportNamePattern,
} from '@eve-space/platform-module-contract'
import type { EsiOperationContract } from './catalog.js'

const scopePattern = /^esi-[a-z0-9_-]+\.[a-z0-9_]+\.v[1-9]\d*$/
const identityFieldPattern = /^[A-Za-z][A-Za-z0-9]*$/
const representationVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const rateWindowPattern = /^[1-9]\d*[smhd]$/
const maximumEsiRequestAttempts = 3

interface RateGroupDefinition {
  operation: string
  scope: 'public' | 'character'
  maximumTokens: number
  window: string
}

interface EsiOperationContractValidationState {
  readonly issues: string[]
  readonly rateGroups: Map<string, RateGroupDefinition>
  readonly sdkOperationOwners: Map<string, string>
  readonly expectedSdkOperationIds: Readonly<Record<string, string>>
}

export function assertEsiOperationContracts(
  catalog: Readonly<Record<string, unknown>>,
  expectedSdkOperationIds: Readonly<Record<string, string>> = {},
): asserts catalog is Readonly<Record<string, EsiOperationContract>> {
  const state: EsiOperationContractValidationState = {
    issues: [],
    rateGroups: new Map(),
    sdkOperationOwners: new Map(),
    expectedSdkOperationIds,
  }

  for (const [operation, value] of Object.entries(catalog))
    validateEsiOperationContract(operation, value, state)

  if (state.issues.length > 0)
    throw new Error(
      `Invalid ESI operation catalog:\n${state.issues
        .toSorted((left, right) => left.localeCompare(right))
        .map((issue) => `- ${issue}`)
        .join('\n')}`,
    )
}

function validateEsiOperationContract(
  operation: string,
  value: unknown,
  state: EsiOperationContractValidationState,
) {
  const { issues, expectedSdkOperationIds, rateGroups, sdkOperationOwners } = state
  if (!platformContributionIdPattern.test(operation))
    issues.push(`operation ${operation} must use a lowercase kebab-case identity`)
  if (!isRecord(value)) {
    issues.push(`operation ${operation} must export a contract object`)
    return
  }

  const audit = validateAudit(operation, value.audit, issues)
  const expectedSdkOperationId = expectedSdkOperationIds[operation]
  if (
    expectedSdkOperationId &&
    audit?.esiOperationId &&
    audit.esiOperationId !== expectedSdkOperationId
  )
    issues.push(
      `operation ${operation} contract declares ${audit.esiOperationId} instead of manifest SDK operation ${expectedSdkOperationId}`,
    )
  if (audit?.esiOperationId) {
    const owner = sdkOperationOwners.get(audit.esiOperationId)
    if (owner)
      issues.push(
        `operation ${operation} duplicates ESI SDK operation ${audit.esiOperationId} from operation ${owner}`,
      )
    else sdkOperationOwners.set(audit.esiOperationId, operation)
  }
  const minimumDate = validateCompatibility(operation, value.compatibility, issues)
  if (audit?.reviewedDate && minimumDate && minimumDate > audit.reviewedDate)
    issues.push(`operation ${operation} minimum compatibility date exceeds its review date`)
  if (
    typeof value.representationVersion !== 'string' ||
    !representationVersionPattern.test(value.representationVersion)
  )
    issues.push(`operation ${operation} has an invalid representation version`)

  const scope = validateAuthorization(operation, value.authorization, issues)
  validateIdentity(operation, value.identity, issues)
  validateResourceRevision(operation, value.resourceRevision, issues)
  validateFreshness(operation, value.freshness, issues)
  validateCache(operation, value.cache, issues)
  validateRateGroup(operation, scope, value.rateGroup, rateGroups, issues)
  validateRetry(operation, value.retry, issues)
  validateResponseValidation(operation, value.responseValidation, issues)
}

function validateAudit(operation: string, value: unknown, issues: string[]) {
  if (!isRecord(value)) {
    issues.push(`operation ${operation} has invalid audit metadata`)
    return undefined
  }
  const esiOperationId =
    typeof value.esiOperationId === 'string' && platformExportNamePattern.test(value.esiOperationId)
      ? value.esiOperationId
      : undefined
  if (!esiOperationId)
    issues.push(`operation ${operation} has an invalid ESI SDK operation identity`)
  const reviewedDate = validateDate(operation, 'review date', value.reviewedDate, issues)
  return esiOperationId && reviewedDate ? { esiOperationId, reviewedDate } : undefined
}

function validateCompatibility(operation: string, value: unknown, issues: string[]) {
  if (!isRecord(value)) {
    issues.push(`operation ${operation} has invalid compatibility metadata`)
    return undefined
  }
  return validateDate(operation, 'minimum compatibility date', value.minimumDate, issues)
}

function validateAuthorization(
  operation: string,
  value: unknown,
  issues: string[],
): RateGroupDefinition['scope'] | undefined {
  if (!isRecord(value)) {
    issues.push(`operation ${operation} has invalid authorization metadata`)
    return undefined
  }
  if (value.kind === 'public') return 'public'
  if (value.kind === 'character') {
    if (typeof value.scope !== 'string' || !scopePattern.test(value.scope))
      issues.push(`operation ${operation} has an invalid character scope`)
    return 'character'
  }
  issues.push(`operation ${operation} uses an unsupported authorization strategy`)
  return undefined
}

function validateIdentity(operation: string, value: unknown, issues: string[]) {
  if (!isRecord(value)) {
    issues.push(`operation ${operation} has invalid identity metadata`)
    return
  }
  switch (value.kind) {
    case 'ordered':
      if (
        !Array.isArray(value.fields) ||
        !value.fields.every(
          (field): field is string => typeof field === 'string' && identityFieldPattern.test(field),
        ) ||
        new Set(value.fields).size !== value.fields.length
      )
        issues.push(`operation ${operation} has invalid or duplicate ordered identity fields`)
      return
    case 'set':
      if (typeof value.field !== 'string' || !identityFieldPattern.test(value.field))
        issues.push(`operation ${operation} has an invalid set identity field`)
      if (!isPositiveSafeInteger(value.maximumItems))
        issues.push(`operation ${operation} set identity maximum must be a positive safe integer`)
      return
    case 'mixed':
      validateMixedIdentity(operation, value.fields, issues)
      return
    default:
      issues.push(`operation ${operation} uses an unsupported identity strategy`)
  }
}

function validateMixedIdentity(operation: string, value: unknown, issues: string[]) {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(`operation ${operation} has invalid mixed identity fields`)
    return
  }
  const names = new Set<string>()
  for (const field of value) {
    if (
      !isRecord(field) ||
      typeof field.field !== 'string' ||
      !identityFieldPattern.test(field.field)
    ) {
      issues.push(`operation ${operation} has an invalid mixed identity field`)
      continue
    }
    if (names.has(field.field))
      issues.push(`operation ${operation} has duplicate mixed identity fields`)
    names.add(field.field)
    if ('nullable' in field && typeof field.nullable !== 'boolean')
      issues.push(`operation ${operation} mixed identity nullable flag must be boolean`)
    if (field.kind === 'scalar') continue
    if (field.kind !== 'set' || !isPositiveSafeInteger(field.maximumItems))
      issues.push(`operation ${operation} has an invalid mixed set identity field`)
  }
}

function validateResourceRevision(operation: string, value: unknown, issues: string[]) {
  if (value === undefined) return
  if (
    !isRecord(value) ||
    value.kind !== 'character' ||
    typeof value.namespace !== 'string' ||
    !platformContributionIdPattern.test(value.namespace)
  )
    issues.push(`operation ${operation} has invalid resource-revision metadata`)
}

function validateFreshness(operation: string, value: unknown, issues: string[]) {
  if (!isRecord(value)) {
    issues.push(`operation ${operation} has invalid freshness metadata`)
    return
  }
  if (value.kind === 'relative') {
    if (!isPositiveSafeInteger(value.seconds))
      issues.push(`operation ${operation} relative freshness must use positive whole seconds`)
    return
  }
  if (value.kind === 'daily-utc') {
    if (!isIntegerInRange(value.hour, 0, 23) || !isIntegerInRange(value.minute, 0, 59))
      issues.push(`operation ${operation} has an invalid daily UTC freshness boundary`)
    return
  }
  if (value.kind !== 'runtime-only' && value.kind !== 'none')
    issues.push(`operation ${operation} uses an unsupported freshness strategy`)
}

function validateCache(operation: string, value: unknown, issues: string[]) {
  if (!isRecord(value)) {
    issues.push(`operation ${operation} has invalid cache metadata`)
    return
  }
  if (value.kind === 'none') return
  if (value.kind !== 'shared') {
    issues.push(`operation ${operation} uses an unsupported cache strategy`)
    return
  }
  if (typeof value.collapse !== 'boolean' || typeof value.revalidate !== 'boolean')
    issues.push(`operation ${operation} shared cache flags must be boolean`)
  if (!isNonNegativeSafeInteger(value.retentionMilliseconds))
    issues.push(`operation ${operation} cache retention must be a non-negative whole duration`)
  if (!isRecord(value.stale)) {
    issues.push(`operation ${operation} has invalid stale cache metadata`)
    return
  }
  if (value.stale.kind === 'none') return
  if (
    (value.stale.kind !== 'bounded' && value.stale.kind !== 'outage') ||
    !isPositiveSafeInteger(value.stale.milliseconds)
  ) {
    issues.push(`operation ${operation} has an invalid bounded stale duration`)
    return
  }
  if (
    isNonNegativeSafeInteger(value.retentionMilliseconds) &&
    value.stale.milliseconds > value.retentionMilliseconds
  )
    issues.push(`operation ${operation} stale duration exceeds cache retention`)
}

function validateRateGroup(
  operation: string,
  scope: RateGroupDefinition['scope'] | undefined,
  value: unknown,
  groups: Map<string, RateGroupDefinition>,
  issues: string[],
) {
  if (!isRecord(value)) {
    issues.push(`operation ${operation} has invalid rate-group metadata`)
    return
  }
  if (value.kind === 'legacy-only') return
  if (value.kind !== 'declared') {
    issues.push(`operation ${operation} uses an unsupported rate-group strategy`)
    return
  }
  const validGroup =
    typeof value.group === 'string' && platformContributionIdPattern.test(value.group)
  const validMaximum = isPositiveSafeInteger(value.maximumTokens)
  const validWindow = typeof value.window === 'string' && rateWindowPattern.test(value.window)
  if (!validGroup || !validMaximum || !validWindow)
    issues.push(`operation ${operation} has invalid declared rate-group metadata`)
  if (!validGroup || !validMaximum || !validWindow || !scope) return

  const definition = {
    operation,
    scope,
    maximumTokens: value.maximumTokens as number,
    window: value.window as string,
  }
  const current = groups.get(value.group as string)
  if (
    current &&
    (current.scope !== definition.scope ||
      current.maximumTokens !== definition.maximumTokens ||
      current.window !== definition.window)
  )
    issues.push(
      `operation ${operation} rate group ${value.group as string} conflicts with operation ${current.operation}`,
    )
  else groups.set(value.group as string, definition)
}

function validateRetry(operation: string, value: unknown, issues: string[]) {
  if (!isRecord(value)) {
    issues.push(`operation ${operation} has invalid retry metadata`)
    return
  }
  if (value.kind === 'none') return
  if (
    value.kind !== 'idempotent' ||
    !isPositiveSafeInteger(value.attempts) ||
    value.attempts > maximumEsiRequestAttempts ||
    !isNonNegativeSafeInteger(value.initialDelayMilliseconds) ||
    !isNonNegativeSafeInteger(value.maximumDelayMilliseconds) ||
    (typeof value.initialDelayMilliseconds === 'number' &&
      typeof value.maximumDelayMilliseconds === 'number' &&
      value.maximumDelayMilliseconds < value.initialDelayMilliseconds)
  )
    issues.push(`operation ${operation} has invalid idempotent retry metadata`)
}

function validateResponseValidation(operation: string, value: unknown, issues: string[]) {
  if (!isRecord(value)) {
    issues.push(`operation ${operation} has invalid response-validation metadata`)
    return
  }
  if (value.kind === 'enabled') return
  if (value.kind !== 'disabled' || typeof value.reason !== 'string' || value.reason.trim() === '')
    issues.push(`operation ${operation} has an invalid response-validation exception`)
}

function validateDate(operation: string, field: string, value: unknown, issues: string[]) {
  if (typeof value === 'string' && isIsoCalendarDate(value)) return value
  issues.push(`operation ${operation} has an invalid ${field}`)
  return undefined
}

export function isIsoCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number) {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum
}
