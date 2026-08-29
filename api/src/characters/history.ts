import { createCharacterClient } from '@evespace/esi-client/domains/character'
import { getEsiResilienceLayer } from '../esi-resilience/resilience.js'
import { createEsiTransport } from '../esi-resilience/transport.js'
import { resolveUniverseNames } from '../universe/names.js'

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

export async function getCharacterEmploymentHistory(
  characterId: number,
): Promise<CharacterEmploymentHistoryEntry[]> {
  return (
    await getEsiResilienceLayer().getPublic<CharacterEmploymentHistoryEntry[]>({
      operation: 'employment-history',
      inputs: { characterId },
      load: async (revalidation) => {
        const response = await createCharacterClient({
          fetch: createEsiTransport('employment-history'),
        })
          .withMetadata()
          .listCorporationHistory(characterId, revalidation)
        const corporationIds = [
          ...new Set(
            response.data
              .filter((record) => !record.is_deleted)
              .map((record) => record.corporation_id),
          ),
        ]
        const names = await resolveUniverseNames(corporationIds)
        return {
          data: response.data.map((record) => {
            const resolved = names.get(record.corporation_id)
            let name = 'Unknown corporation'
            if (record.is_deleted) name = 'Deleted corporation'
            else if (resolved?.category === 'corporation') name = resolved.name
            return {
              recordId: record.record_id,
              startDate: record.start_date,
              isDeleted: record.is_deleted ?? false,
              corporation: {
                id: record.corporation_id,
                name,
                isNpc: isNpcCorporation(record.corporation_id),
              },
            }
          }),
          meta: response.meta,
        }
      },
    })
  ).data
}
