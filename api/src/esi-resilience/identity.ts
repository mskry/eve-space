import { createHash } from 'node:crypto'
import { getEsiOperationContract, type EsiOperation } from './catalog.js'

const maximumStringLength = 256

type IdentityScalar = string | number | boolean | null

export interface EsiRepresentationIdentity {
  operation: EsiOperation
  digest: string
  value: string
  representationVersion: string
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
}): EsiRepresentationIdentity {
  const contract = getEsiOperationContract(options.operation)
  const normalizedInputs = normalizeInputs(contract.identity, options.inputs)
  const canonical = JSON.stringify({
    operation: options.operation,
    inputs: normalizedInputs,
    compatibilityDate: options.compatibilityDate,
    representationVersion: options.representationVersion,
  })
  const digest = createHash('sha256').update(canonical).digest('hex')
  return {
    operation: options.operation,
    digest,
    value: `${options.operation}:${digest}`,
    representationVersion: options.representationVersion,
  }
}

function normalizeInputs(
  identity: ReturnType<typeof getEsiOperationContract>['identity'],
  inputs: Readonly<Record<string, unknown>>,
) {
  const allowedFields = identity.kind === 'ordered' ? identity.fields : [identity.field]
  const identityInputs = isSdkRequestEnvelope(inputs)
    ? projectSdkRequestIdentity(inputs, allowedFields)
    : inputs
  assertIdentityInputFields(identityInputs, allowedFields)

  if (identity.kind === 'ordered')
    return Object.fromEntries(
      identity.fields.map((field) => [field, normalizeScalar(identityInputs[field], field)]),
    )

  const values = identityInputs[identity.field]
  if (!Array.isArray(values))
    throw new Error(`ESI identity input ${identity.field} must be an array`)
  if (values.length === 0 || values.length > identity.maximumItems)
    throw new Error(
      `ESI identity input ${identity.field} must contain between 1 and ${identity.maximumItems} items`,
    )
  const normalized = values.map((value) => normalizeScalar(value, identity.field))
  const unique = new Map(normalized.map((value) => [JSON.stringify(value), value]))
  return {
    [identity.field]: [...unique.entries()]
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([, value]) => value),
  }
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
) {
  const suppliedFields = Object.keys(inputs)
  const unexpected = suppliedFields.filter((field) => !allowedFields.includes(field))
  if (unexpected.length > 0)
    throw new Error(
      `Unexpected ESI identity inputs: ${unexpected.toSorted((left, right) => left.localeCompare(right)).join(', ')}`,
    )
  const missing = allowedFields.filter((field) => !(field in inputs))
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
