import { createCharacterClient } from '@evespace/esi-client/domains/character'
import type { GetCharactersCharacterIdRolesOutput } from '@evespace/esi-client/schemas'
import { getCharacterEsiScope } from '../esi-resilience/catalog.js'
import { getEsiResilienceLayer } from '../esi-resilience/resilience.js'
import { createEsiTransport } from '../esi-resilience/transport.js'

export const characterCorporationRolesScope = getCharacterEsiScope('character-corporation-roles')

export interface CharacterCorporationRoles {
  roles: string[]
  rolesAtBase: string[]
  rolesAtHeadquarters: string[]
  rolesAtOther: string[]
}

export async function getCharacterCorporationRoles(
  characterId: number,
): Promise<CharacterCorporationRoles> {
  return (
    await getEsiResilienceLayer().getCharacter({
      operation: 'character-corporation-roles',
      inputs: { characterId },
      load: async (authority, revalidation) => {
        const response = await createCharacterClient({
          fetch: createEsiTransport('character-corporation-roles', authority.principal),
          token: authority.accessToken,
        })
          .withMetadata()
          .getCorporationRoles(characterId, revalidation)
        return { data: mapCharacterCorporationRoles(response.data), meta: response.meta }
      },
    })
  ).data
}

function mapCharacterCorporationRoles(
  result: GetCharactersCharacterIdRolesOutput,
): CharacterCorporationRoles {
  return {
    roles: result.roles ?? [],
    rolesAtBase: result.roles_at_base ?? [],
    rolesAtHeadquarters: result.roles_at_hq ?? [],
    rolesAtOther: result.roles_at_other ?? [],
  }
}
