import type { PlatformActivityProviderCharacter } from '@eve-space/platform-module-contract'
import { and, asc, desc, eq, gt, isNull, or } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  organizationCharacterExceptions,
  organizationManagedCorporations,
  platformSubjectLifecycles,
} from '../db/schema.js'

export async function loadOrganizationActivityCharacters(
  userId: string,
  organizationVersion: number,
  now = new Date(),
): Promise<readonly PlatformActivityProviderCharacter[]> {
  const rows = await db
    .select({
      characterId: characters.characterId,
      subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
      name: characters.name,
      corporationId: characters.corporationId,
      allianceId: characters.allianceId,
      isMain: characters.isMain,
      affiliationCheckedAt: characters.affiliationCheckedAt,
      nextAffiliationCheck: characters.nextAffiliationCheck,
      affiliationResolutionState: characters.affiliationResolutionState,
      managedCorporationId: organizationManagedCorporations.corporationId,
      exceptionId: organizationCharacterExceptions.exceptionId,
    })
    .from(characters)
    .innerJoin(
      deploymentSettings,
      and(
        eq(deploymentSettings.id, 1),
        eq(deploymentSettings.organizationVersion, organizationVersion),
      ),
    )
    .innerJoin(
      platformSubjectLifecycles,
      eq(platformSubjectLifecycles.characterId, characters.characterId),
    )
    .leftJoin(
      organizationManagedCorporations,
      and(
        eq(organizationManagedCorporations.deploymentId, deploymentSettings.id),
        eq(organizationManagedCorporations.organizationVersion, organizationVersion),
        eq(organizationManagedCorporations.corporationId, characters.corporationId),
        eq(organizationManagedCorporations.isCurrent, true),
      ),
    )
    .leftJoin(
      organizationCharacterExceptions,
      and(
        eq(organizationCharacterExceptions.deploymentId, deploymentSettings.id),
        eq(organizationCharacterExceptions.organizationVersion, organizationVersion),
        eq(organizationCharacterExceptions.userId, userId),
        eq(organizationCharacterExceptions.characterId, characters.characterId),
        isNull(organizationCharacterExceptions.revokedAt),
        isNull(organizationCharacterExceptions.expiredAt),
        or(
          isNull(organizationCharacterExceptions.expiresAt),
          gt(organizationCharacterExceptions.expiresAt, now),
        ),
      ),
    )
    .where(eq(characters.userId, userId))
    .orderBy(desc(characters.isMain), asc(characters.name), asc(characters.characterId))

  if (rows.length === 0)
    throw new Error('Organization activity context is not current for the authorized account')
  return rows.map((row) => {
    if (row.managedCorporationId === null && row.exceptionId === null)
      throw new Error('Organization activity context contains an unclassified character')
    return {
      characterId: row.characterId,
      subjectLifecycleId: row.subjectLifecycleId,
      name: row.name,
      corporationId: row.corporationId,
      allianceId: row.allianceId,
      isMain: row.isMain,
      membership: row.managedCorporationId === null ? 'approved-external' : 'managed',
      affiliationFreshness: affiliationFreshness(row, now),
      affiliationCheckedAt: row.affiliationCheckedAt?.toISOString() ?? null,
    }
  })
}

function affiliationFreshness(
  character: {
    readonly affiliationResolutionState: 'pending' | 'resolved' | 'unresolvable'
    readonly affiliationCheckedAt: Date | null
    readonly nextAffiliationCheck: Date | null
  },
  now: Date,
) {
  if (character.affiliationResolutionState !== 'resolved' || !character.affiliationCheckedAt)
    return 'unavailable' as const
  return character.nextAffiliationCheck && character.nextAffiliationCheck > now
    ? ('fresh' as const)
    : ('stale' as const)
}
