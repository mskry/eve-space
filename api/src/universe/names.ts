import { operationRegistry } from '@evespace/esi-client/operations'
import type { PostUniverseIdsResponse } from '@evespace/esi-client/types'
import { execute } from '../esi-resilience/execute.js'
import { registerEsiRepresentation } from '../esi-resilience/representation-registry.js'
import { definePublicEsiRepresentation } from '../esi-resilience/representations.js'
import {
  readUniverseIds,
  readUniverseNames,
  suppressUniverseIdNames,
  suppressUniverseNameIds,
  writeUniverseIds,
  writeUniverseNames,
} from './resolution-cache.js'

const maximumNameResolutionSplits = 64
const nameResolutionBatchSize = 500
const nameResolutionWorkerConcurrency = 4

const universeIdCategories = {
  agents: 'agent',
  alliances: 'alliance',
  characters: 'character',
  constellations: 'constellation',
  corporations: 'corporation',
  factions: 'faction',
  inventory_types: 'inventory_type',
  regions: 'region',
  stations: 'station',
  systems: 'solar_system',
} as const

export interface UniverseName {
  id: number
  name: string
  category: string
}

export interface UniverseId {
  id: number
  name: string
  category: string
}

interface ResolutionSplitState {
  count: number
}

class UniverseNameResolutionLimitError extends Error {
  readonly status = 424

  constructor() {
    super('Universe name resolution exceeded its split limit')
    this.name = 'UniverseNameResolutionLimitError'
  }
}

const universeNamesRepresentation = registerEsiRepresentation(
  definePublicEsiRepresentation({
    operation: 'universe-resolve-names',
    name: 'universe-names-core',
    descriptor: operationRegistry.PostUniverseNames.transport,
    encodeRequest: (input: { body: number[] }) => input,
    map: ({ data }): UniverseName[] =>
      data.map(({ id, name, category }) => ({ id, name, category })),
  }),
)

const universeIdsRepresentation = registerEsiRepresentation(
  definePublicEsiRepresentation({
    operation: 'universe-resolve-ids',
    name: 'universe-ids-core',
    descriptor: operationRegistry.PostUniverseIds.transport,
    encodeRequest: (input: { body: string[] }) => input,
    map: ({ data }) => mapUniverseIds(data),
  }),
)

export async function resolveUniverseNames(ids: readonly number[]) {
  const result = await resolveUniverseNameResults(ids)
  if (result.failure !== undefined) throw result.failure
  return result.names
}

export async function resolveUniverseNamesBestEffort(ids: readonly number[]) {
  const result = await resolveUniverseNameResults(ids)
  return { names: result.names, complete: result.failure === undefined }
}

async function resolveUniverseNameResults(ids: readonly number[]) {
  const names = new Map<number, UniverseName>()
  const uniqueIds = [...new Set(ids)]
  const cached = await readUniverseNames(uniqueIds)
  for (const [id, entry] of [...cached.stale, ...cached.fresh]) names.set(id, entry)
  const unresolvedIds = uniqueIds.filter(
    (id) => !cached.fresh.has(id) && !cached.suppressed.has(id),
  )
  if (unresolvedIds.length === 0) return { names, failure: undefined }
  const splitState: ResolutionSplitState = { count: 0 }
  const missingIds: number[] = []

  const chunks = Array.from(
    { length: Math.ceil(unresolvedIds.length / nameResolutionBatchSize) },
    (_, index) =>
      unresolvedIds.slice(index * nameResolutionBatchSize, (index + 1) * nameResolutionBatchSize),
  )
  const results = await mapBoundedSettled(chunks, (chunk) =>
    resolveChunkWithSplitting(chunk, splitState, missingIds, (currentChunk) =>
      loadUniverseNameChunk(currentChunk, names, missingIds),
    ),
  )
  await suppressUniverseNameIds(missingIds)
  const failure = results.find((result) => result.status === 'rejected')
  return { names, failure: failure?.reason }
}

export async function resolveUniverseIds(inputNames: readonly string[]) {
  const resolved = new Map<string, UniverseId>()
  const uniqueNames = [...new Set(inputNames)]
  const cached = await readUniverseIds(uniqueNames)
  for (const entries of [...cached.stale.values(), ...cached.fresh.values()])
    for (const entry of entries) resolved.set(`${entry.category}:${entry.id}`, entry)
  const unresolvedNames = uniqueNames.filter(
    (name) => !cached.fresh.has(name) && !cached.suppressed.has(name),
  )
  if (unresolvedNames.length === 0) return [...resolved.values()]
  const splitState: ResolutionSplitState = { count: 0 }
  const missingNames: string[] = []

  const chunks = Array.from(
    { length: Math.ceil(unresolvedNames.length / nameResolutionBatchSize) },
    (_, index) =>
      unresolvedNames.slice(index * nameResolutionBatchSize, (index + 1) * nameResolutionBatchSize),
  )
  const results = await mapBoundedSettled(chunks, (chunk) =>
    resolveChunkWithSplitting(chunk, splitState, missingNames, (currentChunk) =>
      loadUniverseIdChunk(currentChunk, resolved, missingNames),
    ),
  )
  await suppressUniverseIdNames(missingNames)
  const failure = results.find((result) => result.status === 'rejected')
  if (failure) throw failure.reason
  return [...resolved.values()]
}

async function loadUniverseNameChunk(
  chunk: number[],
  names: Map<number, UniverseName>,
  missingIds: number[],
) {
  const response = await execute(universeNamesRepresentation, { body: chunk })
  for (const entry of response.data) names.set(entry.id, entry)
  if (response.stale) return
  const returnedIds = new Set(response.data.map((entry) => entry.id))
  missingIds.push(...chunk.filter((id) => !returnedIds.has(id)))
  await writeUniverseNames(response.data)
}

async function loadUniverseIdChunk(
  chunk: string[],
  resolved: Map<string, UniverseId>,
  missingNames: string[],
) {
  const response = await execute(universeIdsRepresentation, { body: chunk })
  const chunkEntries = collectUniverseIds(response.data, resolved)
  const byName = groupUniverseIdsByInputName(chunk, chunkEntries)
  if (response.stale) return
  missingNames.push(...chunk.filter((name) => !byName.has(name)))
  if (byName.size > 0) await writeUniverseIds(byName)
}

async function resolveChunkWithSplitting<Item>(
  chunk: Item[],
  splitState: ResolutionSplitState,
  missingItems: Item[],
  load: (chunk: Item[]) => Promise<void>,
): Promise<void> {
  try {
    await load(chunk)
  } catch (error) {
    if (errorStatus(error) !== 404) throw error
    if (chunk.length === 1) {
      missingItems.push(chunk[0]!)
      return
    }
    if (splitState.count >= maximumNameResolutionSplits)
      throw new UniverseNameResolutionLimitError()
    splitState.count += 1
    const midpoint = Math.ceil(chunk.length / 2)
    const results = await Promise.allSettled([
      resolveChunkWithSplitting(chunk.slice(0, midpoint), splitState, missingItems, load),
      resolveChunkWithSplitting(chunk.slice(midpoint), splitState, missingItems, load),
    ])
    const failure = results.find((result) => result.status === 'rejected')
    if (failure) throw failure.reason
  }
}

function mapUniverseIds(data: PostUniverseIdsResponse) {
  return Object.entries(universeIdCategories).flatMap(([group, category]) =>
    (data[group as keyof typeof universeIdCategories] ?? []).flatMap((entry) =>
      entry.id === undefined || entry.name === undefined
        ? []
        : [{ id: entry.id, name: entry.name, category }],
    ),
  )
}

function collectUniverseIds(data: readonly UniverseId[], resolved: Map<string, UniverseId>) {
  for (const entry of data) resolved.set(`${entry.category}:${entry.id}`, entry)
  return [...data]
}

function groupUniverseIdsByInputName(chunk: string[], chunkEntries: UniverseId[]) {
  const byName = new Map<string, UniverseId[]>()
  for (const entry of chunkEntries) {
    const input = chunk.find((name) => normalizeName(name) === normalizeName(entry.name))
    if (!input) continue
    const entries = byName.get(input) ?? []
    entries.push(entry)
    byName.set(input, entries)
  }
  return byName
}

function normalizeName(name: string) {
  return name.trim().toLowerCase()
}

function errorStatus(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status: unknown }).status)
    : undefined
}

async function mapBoundedSettled<Item>(
  items: readonly Item[],
  load: (item: Item) => Promise<void>,
) {
  const results = Array.from({ length: items.length }) as PromiseSettledResult<void>[]
  let nextIndex = 0
  const workers = Array.from(
    { length: Math.min(nameResolutionWorkerConcurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex
        nextIndex += 1
        try {
          // oxlint-disable-next-line no-await-in-loop
          results[index] = { status: 'fulfilled', value: await load(items[index]!) }
        } catch (reason) {
          results[index] = { status: 'rejected', reason }
        }
      }
    },
  )
  await Promise.all(workers)
  return results
}
