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
  cacheSchema: characterCorporationRolesCacheSchema,
  descriptor: operationRegistry.GetCharactersCharacterIdRoles.transport,
  encodeRequest: (input: CharacterCorporationRolesRepresentationInput) => ({
    path: { character_id: input.characterId },
  }),
  map: (response) => mapCharacterCorporationRoles(response.data),
  name: 'character-corporation-roles-core',
  operation: 'character-corporation-roles',
})

export const characterCorporationRolesScope = characterCorporationRolesRead.requiredScope

export interface CharacterCorporationRoles {
  roles: string[]
  rolesAtBase: string[]
  rolesAtHeadquarters: string[]
  rolesAtOther: string[]
}

export interface CharacterCorporationRolesEvidence extends CharacterCorporationRoles {
  authorizationGeneration: number
  roleEvidenceRevision: string
  observedAt: Date
  freshUntil: Date
  stale: boolean
}

export async function getCharacterCorporationRoles(
  characterId: number,
  subjectLifecycleId: string,
  signal?: AbortSignal,
): Promise<CharacterCorporationRoles> {
  const evidence = await getCharacterCorporationRolesEvidence(
    characterId,
    subjectLifecycleId,
    signal,
  )
  return {
    roles: evidence.roles,
    rolesAtBase: evidence.rolesAtBase,
    rolesAtHeadquarters: evidence.rolesAtHeadquarters,
    rolesAtOther: evidence.rolesAtOther,
  }
}

export async function getCharacterCorporationRolesEvidence(
  characterId: number,
  subjectLifecycleId: string,
  signal?: AbortSignal,
): Promise<CharacterCorporationRolesEvidence> {
  const result = await characterCorporationRolesRead.execute({
    characterId,
    subjectLifecycleId,
    ...(signal ? { signal } : {}),
  })
  return {
    ...result.data,
    authorizationGeneration: result.authorizationGeneration,
    freshUntil: new Date(result.cachedUntil),
    observedAt: new Date(result.validatedAt),
    roleEvidenceRevision: result.validatedAt,
    stale: result.stale,
  }
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
