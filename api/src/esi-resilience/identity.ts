import { createHash } from 'node:crypto'
import { getEsiOperationContract, type EsiOperation } from './catalog.js'

const maximumStringLength = 256

type IdentityScalar = string | number | boolean | null

export interface EsiRepresentationIdentity {
  operation: EsiOperation
  digest: string
  value: string
  coordinationDigest: string
  representationVersion: string
  resourceRevision?: EsiResourceRevision
}

export interface EsiResourceRevision {
  namespace: string
  value: number
}

/**
 * Canonical ESI principal for a character.
 *
 * The planner records cooldowns against this string and the executor's transport reads them back,
 * so both must derive it here rather than concatenating their own.
 */
export function characterEsiPrincipal(characterId: number | string) {
  return `character-${characterId}`
}

/** Cache-authorization principal, which is additionally bound to the subject lifecycle. */
export function characterLifecycleEsiPrincipal(
  characterId: number | string,
  subjectLifecycleId: string,
) {
  return `${characterEsiPrincipal(characterId)}-lifecycle-${subjectLifecycleId}`
}

export function createEsiRepresentationIdentity(options: {
  operation: EsiOperation
  inputs: Readonly<Record<string, unknown>>
  compatibilityDate: string
  representationVersion: string
  resourceRevision?: EsiResourceRevision
}): EsiRepresentationIdentity {
  const contract = getEsiOperationContract(options.operation)
  const normalizedInputs = normalizeInputs(contract.identity, options.inputs)
  const canonicalBase = {
    operation: options.operation,
    inputs: normalizedInputs,
    compatibilityDate: options.compatibilityDate,
    representationVersion: options.representationVersion,
  }
  const canonical = JSON.stringify({
    ...canonicalBase,
    resourceRevision: options.resourceRevision,
  })
  const digest = createHash('sha256').update(canonical).digest('hex')
  const coordinationDigest = createHash('sha256')
    .update(JSON.stringify(canonicalBase))
    .digest('hex')
  return {
    operation: options.operation,
    digest,
    value: `${options.operation}:${digest}`,
    coordinationDigest,
    representationVersion: options.representationVersion,
    resourceRevision: options.resourceRevision,
  }
}

function normalizeInputs(
  identity: ReturnType<typeof getEsiOperationContract>['identity'],
  inputs: Readonly<Record<string, unknown>>,
) {
  const allowedFields =
    identity.kind === 'ordered'
      ? identity.fields
      : identity.kind === 'set'
        ? [identity.field]
        : identity.fields.map(({ field }) => field)
  const identityInputs = isSdkRequestEnvelope(inputs)
    ? projectSdkRequestIdentity(inputs, allowedFields)
    : inputs
  const nullableFields =
    identity.kind === 'mixed'
      ? identity.fields
          .filter((definition) => 'nullable' in definition && definition.nullable)
          .map(({ field }) => field)
      : []
  assertIdentityInputFields(identityInputs, allowedFields, nullableFields)

  if (identity.kind === 'ordered')
    return Object.fromEntries(
      identity.fields.map((field) => [field, normalizeScalar(identityInputs[field], field)]),
    )

  if (identity.kind === 'mixed')
    return Object.fromEntries(
      identity.fields.map((definition) => {
        const value = identityInputs[definition.field]
        if (
          (value === undefined || value === null) &&
          'nullable' in definition &&
          definition.nullable
        )
          return [definition.field, null]
        if (definition.kind === 'scalar')
          return [definition.field, normalizeScalar(value, definition.field)]
        if (
          Array.isArray(value) &&
          value.length === 0 &&
          'nullable' in definition &&
          definition.nullable
        )
          return [definition.field, null]
        return [definition.field, normalizeSet(value, definition.field, definition.maximumItems)]
      }),
    )

  return {
    [identity.field]: normalizeSet(
      identityInputs[identity.field],
      identity.field,
      identity.maximumItems,
    ),
  }
}

function normalizeSet(value: unknown, field: string, maximumItems: number) {
  const values = value
  if (!Array.isArray(values)) throw new Error(`ESI identity input ${field} must be an array`)
  if (values.length === 0 || values.length > maximumItems)
    throw new Error(`ESI identity input ${field} must contain between 1 and ${maximumItems} items`)
  const normalized = values.map((item) => normalizeScalar(item, field))
  const unique = new Map(
    normalized.map((normalizedValue) => [JSON.stringify(normalizedValue), normalizedValue]),
  )
  return [...unique.entries()]
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, item]) => item)
}

function isSdkRequestEnvelope(inputs: Readonly<Record<string, unknown>>) {
  return ['path', 'query', 'header', 'body'].some((field) => field in inputs)
}

function projectSdkRequestIdentity(
  inputs: Readonly<Record<string, unknown>>,
  fields: readonly string[],
) {
  const unexpected = Object.keys(inputs).filter(
    (field) => !['path', 'query', 'header', 'body'].includes(field),
  )
  if (unexpected.length > 0)
    throw new Error(
      `Unexpected ESI request inputs: ${unexpected.toSorted((left, right) => left.localeCompare(right)).join(', ')}`,
    )

  return Object.fromEntries(
    fields.flatMap((field) => {
      const values = findSdkRequestValues(inputs, field)
      if (values.length === 0) return []
      if (values.length > 1) throw new Error(`Ambiguous ESI identity input ${field}`)
      return [[field, values[0]]]
    }),
  )
}

function findSdkRequestValues(inputs: Readonly<Record<string, unknown>>, field: string) {
  const expectedFields = new Set([field, toSnakeCase(field)])
  const values: unknown[] = []
  for (const section of ['path', 'query', 'header', 'body'] as const) {
    const value = inputs[section]
    if (!isRecord(value)) continue
    findValues(value, expectedFields, values)
  }
  return values
}

function findValues(
  value: Readonly<Record<string, unknown>>,
  fields: ReadonlySet<string>,
  values: unknown[],
) {
  for (const [key, nested] of Object.entries(value)) {
    if (fields.has(key)) values.push(nested)
    else if (isRecord(nested)) findValues(nested, fields, values)
  }
}

function assertIdentityInputFields(
  inputs: Readonly<Record<string, unknown>>,
  allowedFields: readonly string[],
  optionalFields: readonly string[] = [],
) {
  const suppliedFields = Object.keys(inputs)
  const unexpected = suppliedFields.filter((field) => !allowedFields.includes(field))
  if (unexpected.length > 0)
    throw new Error(
      `Unexpected ESI identity inputs: ${unexpected.toSorted((left, right) => left.localeCompare(right)).join(', ')}`,
    )
  const missing = allowedFields.filter(
    (field) => !(field in inputs) && !optionalFields.includes(field),
  )
  if (missing.length > 0)
    throw new Error(
      `Missing ESI identity inputs: ${missing.toSorted((left, right) => left.localeCompare(right)).join(', ')}`,
    )
}

function toSnakeCase(value: string) {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeScalar(value: unknown, field: string): IdentityScalar {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (value.length > maximumStringLength)
      throw new Error(`ESI identity input ${field} exceeds ${maximumStringLength} characters`)
    return value
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  throw new Error(`ESI identity input ${field} must contain only bounded scalar values`)
}
