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
  }
}

const character = createCharacterClient({ fetch: esiFetch })
const universe = createUniverseClient({ fetch: esiFetch })
const cache = new Map<number, { expiresAt: number; history: CharacterEmploymentHistoryEntry[] }>()

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
  const names = new Map<number, string>()

  try {
    const chunks = Array.from({ length: Math.ceil(corporationIds.length / 1_000) }, (_, index) =>
      corporationIds.slice(index * 1_000, (index + 1) * 1_000),
    )
    const resolvedChunks = await Promise.all(chunks.map((body) => universe.resolveNames({ body })))
    for (const resolved of resolvedChunks) {
      for (const entry of resolved) {
        if (entry.category === 'corporation') names.set(entry.id, entry.name)
      }
    }
  } catch {
    // History remains useful when optional corporation-name enrichment is unavailable.
  }

  const history = records
    .map((record) => ({
      recordId: record.record_id,
      startDate: record.start_date,
      isDeleted: record.is_deleted ?? false,
      corporation: {
        id: record.corporation_id,
        name: record.is_deleted
          ? 'Deleted corporation'
          : (names.get(record.corporation_id) ?? 'Unknown corporation'),
      },
    }))
    .toSorted((left, right) => Date.parse(right.startDate) - Date.parse(left.startDate))

  if (cache.size >= 100) cache.delete(cache.keys().next().value ?? characterId)
  cache.set(characterId, { history, expiresAt: Date.now() + 5 * 60_000 })
  return history
}
