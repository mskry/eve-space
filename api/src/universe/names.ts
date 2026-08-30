import {
  createUniverseClient,
  type UniverseDomainClientWithMetadata,
} from '@evespace/esi-client/domains/universe'
import { getEsiResilienceLayer } from '../esi-resilience/resilience.js'
import { createEsiTransport } from '../esi-resilience/transport.js'
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

type UniverseIdsData = Awaited<ReturnType<UniverseDomainClientWithMetadata['resolveIds']>>['data']

class UniverseNameResolutionLimitError extends Error {
  readonly status = 424

  constructor() {
    super('Universe name resolution exceeded its split limit')
    this.name = 'UniverseNameResolutionLimitError'
  }
}

export async function resolveUniverseNames(ids: readonly number[]) {
  const names = new Map<number, UniverseName>()
  const uniqueIds = [...new Set(ids)]
  const cached = await readUniverseNames(uniqueIds)
  for (const [id, entry] of [...cached.stale, ...cached.fresh]) names.set(id, entry)
  const unresolvedIds = uniqueIds.filter(
    (id) => !cached.fresh.has(id) && !cached.suppressed.has(id),
  )
  if (unresolvedIds.length === 0) return names
  const splitState: ResolutionSplitState = { count: 0 }
  const missingIds: number[] = []

  const chunks = Array.from(
    { length: Math.ceil(unresolvedIds.length / nameResolutionBatchSize) },
    (_, index) =>
      unresolvedIds.slice(index * nameResolutionBatchSize, (index + 1) * nameResolutionBatchSize),
  )
  const results = await Promise.allSettled(
    chunks.map((chunk) =>
      resolveChunkWithSplitting(chunk, splitState, missingIds, (currentChunk) =>
        loadUniverseNameChunk(currentChunk, names, missingIds),
      ),
    ),
  )
  await suppressUniverseNameIds(missingIds)
  const failure = results.find((result) => result.status === 'rejected')
  if (failure) throw failure.reason
  return names
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
  const results = await Promise.allSettled(
    chunks.map((chunk) =>
      resolveChunkWithSplitting(chunk, splitState, missingNames, (currentChunk) =>
        loadUniverseIdChunk(currentChunk, resolved, missingNames),
      ),
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
  const response = await getEsiResilienceLayer().getPublic({
    operation: 'universe-resolve-names',
    inputs: { ids: chunk },
    load: (revalidation) =>
      createUniverseClient({ fetch: createEsiTransport('universe-resolve-names') })
        .withMetadata()
        .resolveNames({ body: chunk, ...revalidation }),
  })
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
  const response = await getEsiResilienceLayer().getPublic({
    operation: 'universe-resolve-ids',
    inputs: { names: chunk },
    load: (revalidation) =>
      createUniverseClient({ fetch: createEsiTransport('universe-resolve-ids') })
        .withMetadata()
        .resolveIds({ body: chunk, ...revalidation }),
  })
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

function collectUniverseIds(data: UniverseIdsData, resolved: Map<string, UniverseId>) {
  const chunkEntries: UniverseId[] = []
  for (const [group, category] of Object.entries(universeIdCategories)) {
    const entries = data[group as keyof typeof universeIdCategories] ?? []
    for (const entry of entries) {
      if (entry.id === undefined || entry.name === undefined) continue
      const resolvedEntry = { id: entry.id, name: entry.name, category }
      chunkEntries.push(resolvedEntry)
      resolved.set(`${category}:${entry.id}`, resolvedEntry)
    }
  }
  return chunkEntries
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
