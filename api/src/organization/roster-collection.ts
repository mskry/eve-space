import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  eveTokens,
  organizationCorporationRosterObservations,
  organizationCorporationSources,
  organizationManagedCorporations,
} from '../db/schema.js'
import { corporationMembershipScope } from './corporation-sources.js'

type Transaction = Pick<typeof db, 'delete' | 'insert' | 'select'>

export async function materializeCorporationRoster(
  transaction: Transaction,
  input: {
    organizationVersion: number
    corporationId: number
    sourceId: string
    characterId: number
    tokenVersion: number
    characterIds: number[]
    validatedAt: Date
  },
) {
  const [source] = await transaction
    .select({
      sourceId: organizationCorporationSources.sourceId,
      characterId: organizationCorporationSources.characterId,
      corporationId: characters.corporationId,
      affiliationResolutionState: characters.affiliationResolutionState,
      tokenVersion: eveTokens.tokenVersion,
      scopes: eveTokens.scopes,
    })
    .from(organizationCorporationSources)
    .innerJoin(characters, eq(characters.characterId, organizationCorporationSources.characterId))
    .innerJoin(eveTokens, eq(eveTokens.characterId, organizationCorporationSources.characterId))
    .innerJoin(
      deploymentSettings,
      and(
        eq(deploymentSettings.id, organizationCorporationSources.deploymentId),
        eq(deploymentSettings.organizationVersion, input.organizationVersion),
      ),
    )
    .innerJoin(
      organizationManagedCorporations,
      and(
        eq(
          organizationManagedCorporations.deploymentId,
          organizationCorporationSources.deploymentId,
        ),
        eq(organizationManagedCorporations.organizationVersion, input.organizationVersion),
        eq(organizationManagedCorporations.corporationId, input.corporationId),
        eq(organizationManagedCorporations.isCurrent, true),
      ),
    )
    .where(
      and(
        eq(organizationCorporationSources.sourceId, input.sourceId),
        isNull(organizationCorporationSources.revokedAt),
      ),
    )
    .for('update')
  if (
    source?.characterId !== input.characterId ||
    source.corporationId !== input.corporationId ||
    source.affiliationResolutionState !== 'resolved' ||
    source.tokenVersion !== input.tokenVersion ||
    !source.scopes.includes(corporationMembershipScope)
  )
    return { outcome: 'obsolete' as const }

  await transaction
    .delete(organizationCorporationRosterObservations)
    .where(
      and(
        eq(organizationCorporationRosterObservations.deploymentId, 1),
        eq(
          organizationCorporationRosterObservations.organizationVersion,
          input.organizationVersion,
        ),
        eq(organizationCorporationRosterObservations.corporationId, input.corporationId),
      ),
    )
  if (input.characterIds.length > 0)
    await transaction.insert(organizationCorporationRosterObservations).values(
      input.characterIds.map((characterId) => ({
        deploymentId: 1,
        organizationVersion: input.organizationVersion,
        corporationId: input.corporationId,
        characterId,
        sourceId: input.sourceId,
        observedAt: input.validatedAt,
      })),
    )
  return { outcome: 'refreshed' as const, characterIds: input.characterIds }
}
