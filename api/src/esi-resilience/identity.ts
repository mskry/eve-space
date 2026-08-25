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

  if (identity.kind === 'ordered')
    return Object.fromEntries(
      identity.fields.map((field) => [field, normalizeScalar(inputs[field], field)]),
    )

  const values = inputs[identity.field]
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
