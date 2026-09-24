import { operationRegistry } from '@evespace/esi-client/operations'
import type { GetCharactersCharacterIdCorporationhistoryResponse } from '@evespace/esi-client/types'
import { z } from 'zod'
import { createPublicEsiRead, type EsiReadResult } from '../esi-gateway/feature-execution.js'
import { resolveUniverseNames } from '../universe/names.js'

interface CharacterEmploymentHistoryEntry {
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

const employmentHistoryCacheSchema = z.array(
  z.object({
    corporation: z.object({
      id: z.number(),
      name: z.string(),
      isNpc: z.boolean(),
    }),
    isDeleted: z.boolean(),
    recordId: z.number(),
    startDate: z.string(),
  }),
)

const employmentHistoryRead = createPublicEsiRead({
  cacheSchema: employmentHistoryCacheSchema,
  descriptor: operationRegistry.GetCharactersCharacterIdCorporationhistory.transport,
  encodeRequest: (input: { characterId: number }) => ({
    path: { character_id: input.characterId },
  }),
  map: (response) => mapEmploymentHistory(response.data),
  name: 'employment-history-core',
  operation: 'employment-history',
})

export async function getCharacterEmploymentHistory(
  characterId: number,
): Promise<CharacterEmploymentHistoryEntry[]> {
  return (await getCharacterEmploymentHistoryResult(characterId)).data
}

export function getCharacterEmploymentHistoryResult(
  characterId: number,
): Promise<EsiReadResult<CharacterEmploymentHistoryEntry[]>> {
  return employmentHistoryRead.execute({ characterId })
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
    if (record.is_deleted) {
      name = 'Deleted corporation'
    } else if (resolved?.category === 'corporation') {
      name = resolved.name
    }
    return {
      corporation: {
        id: record.corporation_id,
        isNpc: isNpcCorporation(record.corporation_id),
        name,
      },
      isDeleted: record.is_deleted ?? false,
      recordId: record.record_id,
      startDate: record.start_date,
    }
  })
}

function isNpcCorporation(corporationId: number) {
  return corporationId < FIRST_PLAYER_CORPORATION_ID
}
