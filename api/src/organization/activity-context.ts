import type { PlatformActivityProviderCharacter } from '@eve-space/platform-module-contract/activity'
import { and, asc, desc, eq, gt, isNull, or } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  organizationCharacterExceptions,
  organizationManagedCorporations,
  platformSubjectLifecycles,
} from '../db/schema.js'
import { resolveAffiliationFreshness } from './affiliation-freshness.js'

export async function loadOrganizationActivityCharacters(
  userId: string,
  organizationVersion: number,
  now = new Date(),
): Promise<readonly PlatformActivityProviderCharacter[]> {
  const rows = await db
    .select({
      affiliationCheckedAt: characters.affiliationCheckedAt,
      affiliationResolutionState: characters.affiliationResolutionState,
      allianceId: characters.allianceId,
      characterId: characters.characterId,
      corporationId: characters.corporationId,
      exceptionId: organizationCharacterExceptions.exceptionId,
      isMain: characters.isMain,
      managedCorporationId: organizationManagedCorporations.corporationId,
      name: characters.name,
      nextAffiliationCheck: characters.nextAffiliationCheck,
      subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
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

  if (rows.length === 0) {
    throw new Error('Organization activity context is not current for the authorized account')
  }
  return rows.map((row) => {
    if (row.managedCorporationId === null && row.exceptionId === null) {
      throw new Error('Organization activity context contains an unclassified character')
    }
    return {
      affiliationCheckedAt: row.affiliationCheckedAt?.toISOString() ?? null,
      affiliationFreshness: resolveAffiliationFreshness(row, now),
      allianceId: row.allianceId,
      characterId: row.characterId,
      corporationId: row.corporationId,
      isMain: row.isMain,
      membership: row.managedCorporationId === null ? 'approved-external' : 'managed',
      name: row.name,
      subjectLifecycleId: row.subjectLifecycleId,
    }
  })
}
