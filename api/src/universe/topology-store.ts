import type postgres from 'postgres'
import { sql } from '../db/client.js'
import {
  executeUniverseQuery,
  runBoundedReadTransaction,
  type UniverseDatabase,
  type UniverseQuery,
} from './database-read.js'
import type { UniverseTopologySnapshot, UniverseTopologySystem } from './route-types.js'

interface UniverseTopologyBuildRow extends postgres.Row {
  build_number: string
}

interface UniverseTopologyRow extends postgres.Row {
  dataset: string
  key: string
  id: string | null
  security_status: string | null
  source_system_id: string | null
  destination_system_id: string | null
}

type MutableUniverseTopologySystem = {
  securityStatus: number | null
  neighbors: Set<number>
}

export class UniverseTopologyUnavailableError extends Error {
  constructor(message = 'Universe topology is unavailable') {
    super(message)
    this.name = 'UniverseTopologyUnavailableError'
  }
}

export function readActiveUniverseTopologyBuild(database: UniverseDatabase = sql) {
  return runBoundedReadTransaction(
    database,
    'READ ONLY',
    new UniverseTopologyUnavailableError('Universe topology database operation timed out'),
    selectActiveBuild,
  )
}

export function loadUniverseTopologySnapshot(database: UniverseDatabase = sql) {
  return runBoundedReadTransaction(
    database,
    'ISOLATION LEVEL REPEATABLE READ READ ONLY',
    new UniverseTopologyUnavailableError('Universe topology database operation timed out'),
    async (transaction, signal) => {
      await executeUniverseQuery(
        transaction`lock table sde_builds, sde_dataset_rows in access share mode`,
        signal,
      )
      const buildNumber = await selectActiveBuild(transaction, signal)
      const rows = await executeUniverseQuery(
        transaction<UniverseTopologyRow[]>`
          select
            dataset,
            key,
            data ->> '_key' as id,
            data ->> 'securityStatus' as security_status,
            data ->> 'solarSystemID' as source_system_id,
            data #>> '{destination,solarSystemID}' as destination_system_id
          from sde_dataset_rows
          where dataset in ('mapSolarSystems', 'mapStargates')
          order by dataset, key
        `,
        signal,
      )
      signal.throwIfAborted()
      return buildTopologySnapshot(buildNumber, rows)
    },
  )
}

async function selectActiveBuild(database: UniverseQuery, signal: AbortSignal) {
  const [row] = await executeUniverseQuery(
    database<UniverseTopologyBuildRow[]>`
      select build_number::text as build_number
      from sde_builds
      order by ingested_at desc, build_number desc
      limit 1
    `,
    signal,
  )
  if (!row) throw new UniverseTopologyUnavailableError('Universe topology build is missing')
  return positiveSafeInteger(row.build_number, 'build number')
}

function buildTopologySnapshot(
  buildNumber: number,
  rows: readonly UniverseTopologyRow[],
): UniverseTopologySnapshot {
  const systems = new Map<number, MutableUniverseTopologySystem>()
  const gateRows = new Map<number, UniverseTopologyRow>()

  for (const row of rows) {
    registerTopologyRow(row, systems, gateRows)
  }

  if (systems.size === 0 || gateRows.size === 0)
    throw new UniverseTopologyUnavailableError('Universe topology is incomplete')

  for (const row of gateRows.values()) {
    connectTopologyGate(row, systems)
  }

  const immutableSystems = new Map<number, UniverseTopologySystem>()
  for (const [id, system] of systems) {
    immutableSystems.set(
      id,
      Object.freeze({
        id,
        securityStatus: system.securityStatus,
        neighbors: Object.freeze([...system.neighbors].toSorted((left, right) => left - right)),
      }),
    )
  }
  return Object.freeze({ buildNumber, systems: immutableSystems })
}

function registerTopologyRow(
  row: UniverseTopologyRow,
  systems: Map<number, MutableUniverseTopologySystem>,
  gateRows: Map<number, UniverseTopologyRow>,
) {
  const id = positiveSafeInteger(row.id, `${row.dataset} ID`)
  if (row.key !== String(id))
    throw new UniverseTopologyUnavailableError('Universe topology row key is invalid')

  switch (row.dataset) {
    case 'mapSolarSystems':
      if (systems.has(id))
        throw new UniverseTopologyUnavailableError('Universe topology contains duplicate systems')
      systems.set(id, {
        securityStatus: optionalFiniteSecurity(row.security_status),
        neighbors: new Set(),
      })
      return
    case 'mapStargates':
      if (gateRows.has(id))
        throw new UniverseTopologyUnavailableError('Universe topology contains duplicate stargates')
      gateRows.set(id, row)
      return
    default:
      throw new UniverseTopologyUnavailableError('Universe topology contains an unknown dataset')
  }
}

function connectTopologyGate(
  row: UniverseTopologyRow,
  systems: Map<number, MutableUniverseTopologySystem>,
) {
  const sourceSystemId = positiveSafeInteger(row.source_system_id, 'stargate source system ID')
  const destinationSystemId = positiveSafeInteger(
    row.destination_system_id,
    'stargate destination system ID',
  )
  const source = systems.get(sourceSystemId)
  if (!source || !systems.has(destinationSystemId))
    throw new UniverseTopologyUnavailableError('Universe topology contains an unknown system')
  source.neighbors.add(destinationSystemId)
}

function positiveSafeInteger(value: unknown, label: string) {
  let parsed = Number.NaN
  if (typeof value === 'number') parsed = value
  else if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new UniverseTopologyUnavailableError(`Universe topology ${label} is invalid`)
  return parsed
}

function optionalFiniteSecurity(value: unknown) {
  if (value === null) return null
  if (typeof value === 'string' && (value.length === 0 || value.trim() !== value))
    throw new UniverseTopologyUnavailableError('Universe topology security status is invalid')
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < -1 || parsed > 1)
    throw new UniverseTopologyUnavailableError('Universe topology security status is invalid')
  return parsed
}
