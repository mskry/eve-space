import { operationRegistry } from '@evespace/esi-client/operations'
import type { GetCharactersCharacterIdRolesResponse } from '@evespace/esi-client/types'
import { getCharacterEsiScope } from '../esi-resilience/catalog-access.js'
import { execute } from '../esi-resilience/execute.js'
import { registerEsiRepresentation } from '../esi-resilience/representation-registry.js'
import { defineCharacterEsiRepresentation } from '../esi-resilience/representations.js'

interface CharacterCorporationRolesRepresentationInput {
  characterId: number
}

const characterCorporationRolesRepresentation = registerEsiRepresentation(
  defineCharacterEsiRepresentation({
    operation: 'character-corporation-roles',
    name: 'character-corporation-roles-core',
    descriptor: operationRegistry.GetCharactersCharacterIdRoles.transport,
    encodeRequest: (input: CharacterCorporationRolesRepresentationInput) => ({
      path: { character_id: input.characterId },
    }),
    map: (response) => mapCharacterCorporationRoles(response.data),
  }),
)

export const characterCorporationRolesScope = getCharacterEsiScope(
  characterCorporationRolesRepresentation.operation,
)

export interface CharacterCorporationRoles {
  roles: string[]
  rolesAtBase: string[]
  rolesAtHeadquarters: string[]
  rolesAtOther: string[]
}

export async function getCharacterCorporationRoles(
  characterId: number,
  subjectLifecycleId: string,
  signal?: AbortSignal,
): Promise<CharacterCorporationRoles> {
  return (
    await execute(
      characterCorporationRolesRepresentation,
      { characterId },
      { subjectLifecycleId, signal },
    )
  ).data
}

function mapCharacterCorporationRoles(
  result: GetCharactersCharacterIdRolesResponse,
): CharacterCorporationRoles {
  return {
    roles: result.roles ?? [],
    rolesAtBase: result.roles_at_base ?? [],
    rolesAtHeadquarters: result.roles_at_hq ?? [],
    rolesAtOther: result.roles_at_other ?? [],
  }
}
