import { createSkillsClient } from '@evespace/esi-client/domains/skills'
import type { GetCharactersCharacterIdAttributesOutput } from '@evespace/esi-client/schemas'
import { getCharacterEsiScope } from '../esi-resilience/catalog.js'
import { toEsiResultMetadata } from '../esi-resilience/public-metadata.js'
import { getEsiResilienceLayer } from '../esi-resilience/resilience.js'
import { createEsiTransport } from '../esi-resilience/transport.js'
import type { EsiResultMetadata } from '../esi-resilience/types.js'

export const characterAttributesScope = getCharacterEsiScope('attributes')

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

export async function getCharacterAttributes(characterId: number): Promise<CharacterAttributes> {
  const result = await getEsiResilienceLayer().getCharacter({
    operation: 'attributes',
    inputs: { characterId },
    load: async (authority, revalidation) => {
      const response = await createSkillsClient({
        fetch: createEsiTransport('attributes', authority.principal),
        token: authority.accessToken,
      })
        .withMetadata()
        .getAttributes(characterId, revalidation)
      return { data: mapCharacterAttributes(response.data), meta: response.meta }
    },
  })
  return { ...result.data, ...toEsiResultMetadata(result) }
}

function mapCharacterAttributes(
  result: GetCharactersCharacterIdAttributesOutput,
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
