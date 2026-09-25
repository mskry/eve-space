import { operationRegistry } from '@evespace/esi-client/operations'
import type { GetCharactersCharacterIdRolesResponse } from '@evespace/esi-client/types'
import { z } from 'zod'
import { createCharacterEsiRead } from '../esi-gateway/feature-execution.js'
import {
  canonicalizeCorporationRoleSets,
  type CorporationRoleSets,
} from './corporation-role-canonical.js'

export interface CharacterCorporationRolesReadInput {
  readonly characterId: number
  readonly subjectLifecycleId: string
  readonly affiliationPeriodRevision: string
  readonly signal?: AbortSignal
}

export interface CharacterCorporationRolesRead {
  readonly roles: CorporationRoleSets
  readonly authorizationGeneration: number
  readonly validatedAt: Date
  readonly cachedUntil: Date
  readonly stale: boolean
  readonly retryAt: Date | null
}

const characterCorporationRolesCacheSchema = z.object({
  roles: z.array(z.string()),
  rolesAtBase: z.array(z.string()),
  rolesAtHeadquarters: z.array(z.string()),
  rolesAtOther: z.array(z.string()),
})

const mapCharacterCorporationRoles = (
  result: GetCharactersCharacterIdRolesResponse,
): CorporationRoleSets =>
  canonicalizeCorporationRoleSets({
    roles: result.roles ?? [],
    rolesAtBase: result.roles_at_base ?? [],
    rolesAtHeadquarters: result.roles_at_hq ?? [],
    rolesAtOther: result.roles_at_other ?? [],
  })

const characterCorporationRolesRead = createCharacterEsiRead({
  cacheIdentity: (input: CharacterCorporationRolesReadInput) => ({
    affiliationPeriodRevision: input.affiliationPeriodRevision,
    characterId: input.characterId,
  }),
  cacheSchema: characterCorporationRolesCacheSchema,
  descriptor: operationRegistry.GetCharactersCharacterIdRoles.transport,
  encodeRequest: (input: CharacterCorporationRolesReadInput) => ({
    path: { character_id: input.characterId },
  }),
  map: (response) => mapCharacterCorporationRoles(response.data),
  name: 'character-corporation-roles-core',
  operation: 'character-corporation-roles',
})

export const characterCorporationRolesScope = characterCorporationRolesRead.requiredScope

export const readCharacterCorporationRoles = async (
  input: CharacterCorporationRolesReadInput,
): Promise<CharacterCorporationRolesRead> => {
  const result = await characterCorporationRolesRead.execute(input)
  return {
    authorizationGeneration: result.authorizationGeneration,
    cachedUntil: new Date(result.cachedUntil),
    retryAt: result.retryAt ? new Date(result.retryAt) : null,
    roles: canonicalizeCorporationRoleSets(result.data),
    stale: result.stale,
    validatedAt: new Date(result.validatedAt),
  }
}
