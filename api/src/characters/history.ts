import { operationRegistry } from '@evespace/esi-client/operations'
import type { GetCharactersCharacterIdCorporationhistoryResponse } from '@evespace/esi-client/types'
import { execute } from '../esi-resilience/execute.js'
import { registerEsiRepresentation } from '../esi-resilience/representation-registry.js'
import { definePublicEsiRepresentation } from '../esi-resilience/representations.js'
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

const employmentHistoryRepresentation = registerEsiRepresentation(
  definePublicEsiRepresentation({
    operation: 'employment-history',
    name: 'employment-history-core',
    descriptor: operationRegistry.GetCharactersCharacterIdCorporationhistory.transport,
    encodeRequest: (input: { characterId: number }) => ({
      path: { character_id: input.characterId },
    }),
    map: (response) => mapEmploymentHistory(response.data),
  }),
)

export async function getCharacterEmploymentHistory(
  characterId: number,
): Promise<CharacterEmploymentHistoryEntry[]> {
  return (await execute(employmentHistoryRepresentation, { characterId })).data
}

async function mapEmploymentHistory(
  records: GetCharactersCharacterIdCorporationhistoryResponse,
): Promise<CharacterEmploymentHistoryEntry[]> {
  const corporationIds = [
    ...new Set(
      records.filter((record) => !record.is_deleted).map((record) => record.corporation_id),
    ),
  ]
  const names = await resolveUniverseNames(corporationIds)
  return records.map((record) => {
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
  })
}

function isNpcCorporation(corporationId: number) {
  return corporationId < FIRST_PLAYER_CORPORATION_ID
}
