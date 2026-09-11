import { operationRegistry } from '@evespace/esi-client/operations'
import type { GetCharactersCharacterIdAttributesResponse } from '@evespace/esi-client/types'
import { getCharacterEsiScope } from '../esi-resilience/catalog-access.js'
import { execute } from '../esi-resilience/execute.js'
import { registerEsiRepresentation } from '../esi-resilience/representation-registry.js'
import { defineCharacterEsiRepresentation } from '../esi-resilience/representations.js'
import { toEsiResultMetadata } from '../esi-resilience/result-metadata.js'
import type { EsiResultMetadata } from '../esi-resilience/types.js'

interface CharacterAttributesRepresentationInput {
  characterId: number
}

const characterAttributesRepresentation = registerEsiRepresentation(
  defineCharacterEsiRepresentation({
    operation: 'attributes',
    name: 'character-attributes-core',
    descriptor: operationRegistry.GetCharactersCharacterIdAttributes.transport,
    encodeRequest: (input: CharacterAttributesRepresentationInput) => ({
      path: { character_id: input.characterId },
    }),
    map: (response) => mapCharacterAttributes(response.data),
  }),
)

export const characterAttributesScope = getCharacterEsiScope(
  characterAttributesRepresentation.operation,
)

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

export type CharacterAttributes = CharacterAttributesData & EsiResultMetadata

export async function getCharacterAttributes(
  characterId: number,
  subjectLifecycleId: string,
): Promise<CharacterAttributes> {
  const result = await execute(
    characterAttributesRepresentation,
    { characterId },
    { subjectLifecycleId },
  )
  return { ...result.data, ...toEsiResultMetadata(result) }
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
