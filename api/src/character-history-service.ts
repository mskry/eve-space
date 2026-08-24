import { createCharacterClient } from '@evespace/esi-client/domains/character'
import { createUniverseClient } from '@evespace/esi-client/domains/universe'
import { getEsiResilienceLayer } from './esi-resilience/resilience.js'
import { createEsiTransport } from './esi-resilience/transport.js'

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

const MAX_NAME_RESOLUTION_SPLITS = 64

async function resolveCorporationNames(corporationIds: number[]) {
  const names = new Map<number, string>()
  let splits = 0

  async function resolveChunk(ids: number[]): Promise<void> {
    try {
      const resolved = await getEsiResilienceLayer().get({
        operation: 'universe-resolve-names',
        resource: `names-${ids.join('-')}`,
        load: () =>
          createUniverseClient({ fetch: createEsiTransport('universe-resolve-names') })
            .withMetadata()
            .resolveNames({ body: ids }),
      })
      for (const entry of resolved.data) {
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

  const chunks = Array.from({ length: Math.ceil(corporationIds.length / 500) }, (_, index) =>
    corporationIds.slice(index * 500, (index + 1) * 500),
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
  const records = (
    await getEsiResilienceLayer().get({
      operation: 'employment-history',
      resource: `employment-history-${characterId}`,
      load: (revalidation) =>
        createCharacterClient({ fetch: createEsiTransport('employment-history') })
          .withMetadata()
          .listCorporationHistory(characterId, revalidation),
    })
  ).data
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

  return history
}
