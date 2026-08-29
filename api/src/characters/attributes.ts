import { createSkillsClient } from '@evespace/esi-client/domains/skills'
import type { GetCharactersCharacterIdAttributesOutput } from '@evespace/esi-client/schemas'
import { getCharacterEsiScope } from '../esi-resilience/catalog.js'
import { getEsiResilienceLayer } from '../esi-resilience/resilience.js'
import { createEsiTransport } from '../esi-resilience/transport.js'

export const characterAttributesScope = getCharacterEsiScope('attributes')

export interface CharacterAttributes {
  charisma: number
  intelligence: number
  memory: number
  perception: number
  willpower: number
  bonusRemaps: number
  accruedRemapCooldownDate: string | null
  lastRemapDate: string | null
}

export async function getCharacterAttributes(characterId: number): Promise<CharacterAttributes> {
  return (
    await getEsiResilienceLayer().getCharacter({
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
  ).data
}

function mapCharacterAttributes(
  result: GetCharactersCharacterIdAttributesOutput,
): CharacterAttributes {
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
