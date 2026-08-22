import { createCharacterClient } from '@evespace/esi-client/domains/character'
import { createUniverseClient } from '@evespace/esi-client/domains/universe'
import { esiFetch } from './esi-fetch.js'

export interface CharacterEmploymentHistoryEntry {
  recordId: number
  startDate: string
  isDeleted: boolean
  corporation: {
    id: number
    name: string
    isNpc: boolean
  }
}

/** CCP allocates NPC corporations below this ID; player-created corporations sit above it. */
const FIRST_PLAYER_CORPORATION_ID = 2_000_000

function isNpcCorporation(corporationId: number) {
  return corporationId < FIRST_PLAYER_CORPORATION_ID
}

const character = createCharacterClient({ fetch: esiFetch })
const universe = createUniverseClient({ fetch: esiFetch })
const cache = new Map<number, { expiresAt: number; history: CharacterEmploymentHistoryEntry[] }>()
const MAX_NAME_RESOLUTION_SPLITS = 64

async function resolveCorporationNames(corporationIds: number[]) {
  const names = new Map<number, string>()
  let splits = 0

  async function resolveChunk(ids: number[]): Promise<void> {
    try {
      const resolved = await universe.resolveNames({ body: ids })
      for (const entry of resolved) {
        if (entry.category === 'corporation') names.set(entry.id, entry.name)
      }
    } catch (error) {
      // ESI returns 404 when a batch contains an invalid historical ID. Retrying
      // other failures would amplify outages and consume the shared error budget.
      if (errorStatus(error) !== 404 || ids.length === 1 || splits >= MAX_NAME_RESOLUTION_SPLITS)
        return

      splits += 1
      const midpoint = Math.ceil(ids.length / 2)
      await Promise.all([resolveChunk(ids.slice(0, midpoint)), resolveChunk(ids.slice(midpoint))])
    }
  }

  const chunks = Array.from({ length: Math.ceil(corporationIds.length / 1_000) }, (_, index) =>
    corporationIds.slice(index * 1_000, (index + 1) * 1_000),
  )
  await Promise.all(chunks.map(resolveChunk))
  return names
}

function errorStatus(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status: unknown }).status)
    : undefined
}

export async function getCharacterEmploymentHistory(
  characterId: number,
): Promise<CharacterEmploymentHistoryEntry[]> {
  const cached = cache.get(characterId)
  if (cached && cached.expiresAt > Date.now()) return cached.history

  const records = await character.listCorporationHistory(characterId)
  const corporationIds = [
    ...new Set(
      records.filter((record) => !record.is_deleted).map((record) => record.corporation_id),
    ),
  ]
  const names = await resolveCorporationNames(corporationIds)

  const history = records.map((record) => ({
    recordId: record.record_id,
    startDate: record.start_date,
    isDeleted: record.is_deleted ?? false,
    corporation: {
      id: record.corporation_id,
      name: record.is_deleted
        ? 'Deleted corporation'
        : (names.get(record.corporation_id) ?? 'Unknown corporation'),
      isNpc: isNpcCorporation(record.corporation_id),
    },
  }))

  if (cache.size >= 100) cache.delete(cache.keys().next().value ?? characterId)
  cache.set(characterId, { history, expiresAt: Date.now() + 5 * 60_000 })
  return history
}
