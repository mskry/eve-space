import type { SdeProjectionRevision } from '@eve-space/core-data-contract'
import type postgres from 'postgres'
import { executeUniverseQuery } from '../universe/database-read.js'

interface RevisionRow extends postgres.Row {
  build_number: string
  ingest_version: number
  ingested_at: string
}

export class CoreDataProductUnavailableError extends Error {
  constructor(message = 'Core data product is unavailable') {
    super(message)
    this.name = 'CoreDataProductUnavailableError'
  }
}

export async function selectCoreDataRevision(
  transaction: postgres.TransactionSql,
  signal: AbortSignal,
): Promise<SdeProjectionRevision> {
  const [row] = await executeUniverseQuery(
    transaction<RevisionRow[]>`
      select
        builds.build_number::text as build_number,
        builds.ingest_version,
        builds.ingested_at::text as ingested_at
      from sde_projection_state as state
      inner join sde_builds as builds on builds.build_number = state.active_build_number
      where state.singleton = true
    `,
    signal,
  )
  if (!row) {
    throw new CoreDataProductUnavailableError('Committed SDE revision is missing')
  }
  return {
    buildNumber: positiveSafeInteger(row.build_number, 'build number'),
    ingestVersion: positiveSafeInteger(row.ingest_version, 'ingest version'),
    ingestedAt: nonemptyString(row.ingested_at, 'ingestion timestamp'),
  }
}

export function boundedPositiveIds(
  request: unknown,
  property: string,
  productLabel: string,
  maximum: number,
) {
  if (!isRecord(request)) {
    throw new TypeError(`${productLabel} request must contain a ${property} array`)
  }
  const values: unknown = Object.getOwnPropertyDescriptor(request, property)?.value
  if (!Array.isArray(values)) {
    throw new TypeError(`${productLabel} request must contain a ${property} array`)
  }
  const parsed: number[] = []
  for (const value of values) {
    if (!isPositiveSafeInteger(value))
      throw new TypeError(`${productLabel} IDs must be positive safe integers`)
    parsed.push(value)
  }
  const uniqueValues = [...new Set(parsed)]
  if (uniqueValues.length > maximum) {
    throw new RangeError(`${productLabel} lookup cannot exceed ${maximum} IDs`)
  }
  return uniqueValues
}

export function positiveSafeInteger(value: unknown, label: string) {
  let parsed = Number.NaN
  if (isPositiveSafeInteger(value)) {
    parsed = value
  } else if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) {
    parsed = Number(value)
  }
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new CoreDataProductUnavailableError(`Core-data ${label} is invalid`)
  }
  return parsed
}

export function nonemptyString(value: unknown, label: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CoreDataProductUnavailableError(`Core-data ${label} is invalid`)
  }
  return value
}

export function nullableNonnegativeFinite(value: unknown, label: string) {
  if (value === null) {
    return null
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new CoreDataProductUnavailableError(`Core-data ${label} is invalid`)
  }
  return value
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isRecord(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}
