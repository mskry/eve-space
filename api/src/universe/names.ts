import { createUniverseClient } from '@evespace/esi-client/domains/universe'
import { getEsiResilienceLayer } from '../esi-resilience/resilience.js'
import { createEsiTransport } from '../esi-resilience/transport.js'

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

class UniverseNameResolutionLimitError extends Error {
  readonly status = 424

  constructor() {
    super('Universe name resolution exceeded its split limit')
    this.name = 'UniverseNameResolutionLimitError'
  }
}

export async function resolveUniverseNames(ids: readonly number[]) {
  const names = new Map<number, UniverseName>()
  let splits = 0

  async function resolveChunk(chunk: number[]): Promise<void> {
    try {
      const response = await getEsiResilienceLayer().getPublic({
        operation: 'universe-resolve-names',
        inputs: { ids: chunk },
        load: (revalidation) =>
          createUniverseClient({ fetch: createEsiTransport('universe-resolve-names') })
            .withMetadata()
            .resolveNames({ body: chunk, ...revalidation }),
      })
      for (const entry of response.data) names.set(entry.id, entry)
    } catch (error) {
      if (errorStatus(error) !== 404) throw error
      if (chunk.length === 1) return
      if (splits >= maximumNameResolutionSplits) throw new UniverseNameResolutionLimitError()
      splits += 1
      const midpoint = Math.ceil(chunk.length / 2)
      await Promise.all([
        resolveChunk(chunk.slice(0, midpoint)),
        resolveChunk(chunk.slice(midpoint)),
      ])
    }
  }

  const uniqueIds = [...new Set(ids)]
  const chunks = Array.from(
    { length: Math.ceil(uniqueIds.length / nameResolutionBatchSize) },
    (_, index) =>
      uniqueIds.slice(index * nameResolutionBatchSize, (index + 1) * nameResolutionBatchSize),
  )
  await Promise.all(chunks.map(resolveChunk))
  return names
}

export async function resolveUniverseIds(inputNames: readonly string[]) {
  const resolved = new Map<string, UniverseId>()
  let splits = 0

  async function resolveChunk(chunk: string[]): Promise<void> {
    try {
      const response = await getEsiResilienceLayer().getPublic({
        operation: 'universe-resolve-ids',
        inputs: { names: chunk },
        load: (revalidation) =>
          createUniverseClient({ fetch: createEsiTransport('universe-resolve-ids') })
            .withMetadata()
            .resolveIds({ body: chunk, ...revalidation }),
      })
      for (const [group, category] of Object.entries(universeIdCategories)) {
        const entries = response.data[group as keyof typeof universeIdCategories] ?? []
        for (const entry of entries) {
          if (entry.id === undefined || entry.name === undefined) continue
          resolved.set(`${category}:${entry.id}`, { id: entry.id, name: entry.name, category })
        }
      }
    } catch (error) {
      if (errorStatus(error) !== 404) throw error
      if (chunk.length === 1) return
      if (splits >= maximumNameResolutionSplits) throw new UniverseNameResolutionLimitError()
      splits += 1
      const midpoint = Math.ceil(chunk.length / 2)
      await Promise.all([
        resolveChunk(chunk.slice(0, midpoint)),
        resolveChunk(chunk.slice(midpoint)),
      ])
    }
  }

  const uniqueNames = [...new Set(inputNames)]
  const chunks = Array.from(
    { length: Math.ceil(uniqueNames.length / nameResolutionBatchSize) },
    (_, index) =>
      uniqueNames.slice(index * nameResolutionBatchSize, (index + 1) * nameResolutionBatchSize),
  )
  await Promise.all(chunks.map(resolveChunk))
  return [...resolved.values()]
}

function errorStatus(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status: unknown }).status)
    : undefined
}
