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
  accruedRemapCooldownDate: z.string().nullable(),
  bonusRemaps: z.number(),
  charisma: z.number(),
  intelligence: z.number(),
  lastRemapDate: z.string().nullable(),
  memory: z.number(),
  perception: z.number(),
  willpower: z.number(),
})

const characterAttributesRead = createCharacterEsiRead({
  cacheSchema: characterAttributesCacheSchema,
  descriptor: operationRegistry.GetCharactersCharacterIdAttributes.transport,
  encodeRequest: (input: CharacterAttributesRepresentationInput) => ({
    path: { character_id: input.characterId },
  }),
  map: (response) => mapCharacterAttributes(response.data),
  name: 'character-attributes-core',
  operation: 'attributes',
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
    accruedRemapCooldownDate: result.accrued_remap_cooldown_date ?? null,
    bonusRemaps: result.bonus_remaps ?? 0,
    charisma: result.charisma,
    intelligence: result.intelligence,
    lastRemapDate: result.last_remap_date ?? null,
    memory: result.memory,
    perception: result.perception,
    willpower: result.willpower,
  }
}
