import type postgres from 'postgres'
import { sql } from '../db/client.js'
import {
  executeUniverseQuery,
  runBoundedReadTransaction,
  type UniverseDatabase,
  type UniverseQuery,
} from './database-read.js'
import type {
  StaticLocationRevision,
  StaticLocationSnapshot,
  StaticSolarSystem,
} from './static-location-types.js'

export {
  universeDatabaseOperationTimeoutMilliseconds as staticLocationDatabaseOperationTimeoutMilliseconds,
  universeDatabaseTimeoutMilliseconds as staticLocationDatabaseTimeoutMilliseconds,
} from './database-read.js'

type StaticLocationDatabase = UniverseDatabase
type StaticLocationQuery = UniverseQuery

interface StaticLocationRevisionRow extends postgres.Row {
  build_number: string
  ingest_version: number
  ingested_at: string
}

interface StaticSolarSystemRow extends postgres.Row {
  solar_system_id: string
  name: string
  security_status: number
}

interface StaticNpcStationRow extends postgres.Row {
  station_id: string
  solar_system_id: string
}

export class StaticLocationProjectionUnavailableError extends Error {
  constructor(message = 'Static location projection is unavailable') {
    super(message)
    this.name = 'StaticLocationProjectionUnavailableError'
  }
}

export function readStaticLocationRevision(database: StaticLocationDatabase = sql) {
  return runBoundedReadTransaction(
    database,
    'READ ONLY',
    new StaticLocationProjectionUnavailableError('Static location database operation timed out'),
    selectLatestRevision,
  )
}

export function loadStaticLocationSnapshot(database: StaticLocationDatabase = sql) {
  return runBoundedReadTransaction(
    database,
    'ISOLATION LEVEL REPEATABLE READ READ ONLY',
    new StaticLocationProjectionUnavailableError('Static location database operation timed out'),
    async (transaction, signal) => {
      await executeUniverseQuery(
        transaction`
          lock table sde_builds, sde_solar_systems, sde_npc_stations in access share mode
        `,
        signal,
      )
      const revision = await selectLatestRevision(transaction, signal)
      const systemRows = await executeUniverseQuery(
        transaction<StaticSolarSystemRow[]>`
          select
            solar_system_id::text as solar_system_id,
            name,
            security_status
          from sde_solar_systems
          order by solar_system_id
        `,
        signal,
      )
      const stationRows = await executeUniverseQuery(
        transaction<StaticNpcStationRow[]>`
          select station_id::text as station_id, solar_system_id::text as solar_system_id
          from sde_npc_stations
          order by station_id
        `,
        signal,
      )
      signal.throwIfAborted()
      return buildSnapshot(revision, systemRows, stationRows)
    },
  )
}

async function selectLatestRevision(database: StaticLocationQuery, signal: AbortSignal) {
  const [row] = await executeUniverseQuery(
    database<StaticLocationRevisionRow[]>`
      select
        build_number::text as build_number,
        ingest_version,
        ingested_at::text as ingested_at
      from sde_builds
      order by ingested_at desc, build_number desc
      limit 1
    `,
    signal,
  )
  if (!row)
    throw new StaticLocationProjectionUnavailableError('Static location revision is missing')
  return {
    buildNumber: positiveSafeInteger(row.build_number, 'build number'),
    ingestVersion: positiveSafeInteger(row.ingest_version, 'ingest version'),
    ingestedAt: nonemptyString(row.ingested_at, 'ingestion timestamp'),
  }
}

function buildSnapshot(
  revision: StaticLocationRevision,
  systemRows: readonly StaticSolarSystemRow[],
  stationRows: readonly StaticNpcStationRow[],
): StaticLocationSnapshot {
  if (systemRows.length === 0 || stationRows.length === 0)
    throw new StaticLocationProjectionUnavailableError('Static location projection is incomplete')

  const systems = new Map<number, StaticSolarSystem>()
  for (const row of systemRows) {
    const id = positiveSafeInteger(row.solar_system_id, 'solar system ID')
    const name = nonemptyString(row.name, 'solar system name')
    const securityStatus = finiteSecurity(row.security_status)
    if (systems.has(id))
      throw new StaticLocationProjectionUnavailableError(
        'Static location projection has duplicates',
      )
    systems.set(id, Object.freeze({ id, name, securityStatus }))
  }

  const stationSystemIds = new Map<number, number>()
  for (const row of stationRows) {
    const stationId = positiveSafeInteger(row.station_id, 'station ID')
    const systemId = positiveSafeInteger(row.solar_system_id, 'station solar system ID')
    if (!systems.has(systemId))
      throw new StaticLocationProjectionUnavailableError(
        'Static location projection contains an unknown station system',
      )
    if (stationSystemIds.has(stationId))
      throw new StaticLocationProjectionUnavailableError(
        'Static location projection has duplicates',
      )
    stationSystemIds.set(stationId, systemId)
  }

  return Object.freeze({ revision: Object.freeze(revision), systems, stationSystemIds })
}

function positiveSafeInteger(value: unknown, label: string) {
  let parsed = Number.NaN
  if (typeof value === 'number') parsed = value
  else if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new StaticLocationProjectionUnavailableError(`Static location ${label} is invalid`)
  return parsed
}

function nonemptyString(value: unknown, label: string) {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new StaticLocationProjectionUnavailableError(`Static location ${label} is invalid`)
  return value
}

function finiteSecurity(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -1 || value > 1)
    throw new StaticLocationProjectionUnavailableError('Static location security is invalid')
  return value
}
