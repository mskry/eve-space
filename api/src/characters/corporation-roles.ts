import { operationRegistry } from '@evespace/esi-client/operations'
import type { GetCharactersCharacterIdRolesResponse } from '@evespace/esi-client/types'
import { z } from 'zod'
import { createCharacterEsiRead } from '../esi-gateway/feature-execution.js'

interface CharacterCorporationRolesRepresentationInput {
  characterId: number
  subjectLifecycleId: string
  signal?: AbortSignal
}

const characterCorporationRolesCacheSchema = z.object({
  roles: z.array(z.string()),
  rolesAtBase: z.array(z.string()),
  rolesAtHeadquarters: z.array(z.string()),
  rolesAtOther: z.array(z.string()),
})

const characterCorporationRolesRead = createCharacterEsiRead({
  operation: 'character-corporation-roles',
  name: 'character-corporation-roles-core',
  descriptor: operationRegistry.GetCharactersCharacterIdRoles.transport,
  cacheSchema: characterCorporationRolesCacheSchema,
  encodeRequest: (input: CharacterCorporationRolesRepresentationInput) => ({
    path: { character_id: input.characterId },
  }),
  map: (response) => mapCharacterCorporationRoles(response.data),
})

export const characterCorporationRolesScope = characterCorporationRolesRead.requiredScope

interface CharacterCorporationRoles {
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
    await characterCorporationRolesRead.execute({
      characterId,
      subjectLifecycleId,
      ...(signal ? { signal } : {}),
    })
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
