import { operationRegistry } from '@evespace/esi-client/operations'
import type { GetCharactersCharacterIdAttributesResponse } from '@evespace/esi-client/types'
import { z } from 'zod'
import {
  createCharacterEsiRead,
  toEsiReadResultMetadata,
  type EsiReadResultMetadata,
} from '../esi-gateway/feature-execution.js'

interface CharacterAttributesRepresentationInput {
  characterId: number
  subjectLifecycleId: string
}

const characterAttributesCacheSchema = z.object({
  charisma: z.number(),
  intelligence: z.number(),
  memory: z.number(),
  perception: z.number(),
  willpower: z.number(),
  bonusRemaps: z.number(),
  accruedRemapCooldownDate: z.string().nullable(),
  lastRemapDate: z.string().nullable(),
})

const characterAttributesRead = createCharacterEsiRead({
  operation: 'attributes',
  name: 'character-attributes-core',
  descriptor: operationRegistry.GetCharactersCharacterIdAttributes.transport,
  cacheSchema: characterAttributesCacheSchema,
  encodeRequest: (input: CharacterAttributesRepresentationInput) => ({
    path: { character_id: input.characterId },
  }),
  map: (response) => mapCharacterAttributes(response.data),
})

export const characterAttributesScope = characterAttributesRead.requiredScope

interface CharacterAttributesData {
  charisma: number
  intelligence: number
  memory: number
  perception: number
  willpower: number
  bonusRemaps: number
  accruedRemapCooldownDate: string | null
  lastRemapDate: string | null
}

type CharacterAttributes = CharacterAttributesData & EsiReadResultMetadata

export async function getCharacterAttributes(
  characterId: number,
  subjectLifecycleId: string,
): Promise<CharacterAttributes> {
  const result = await characterAttributesRead.execute({ characterId, subjectLifecycleId })
  return { ...result.data, ...toEsiReadResultMetadata(result) }
}

function mapCharacterAttributes(
  result: GetCharactersCharacterIdAttributesResponse,
): CharacterAttributesData {
  return {
    charisma: result.charisma,
    intelligence: result.intelligence,
    memory: result.memory,
    perception: result.perception,
    willpower: result.willpower,
    bonusRemaps: result.bonus_remaps ?? 0,
    accruedRemapCooldownDate: result.accrued_remap_cooldown_date ?? null,
    lastRemapDate: result.last_remap_date ?? null,
  }
}
