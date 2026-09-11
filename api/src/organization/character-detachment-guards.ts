import { and, eq, isNull } from 'drizzle-orm'
import type { DatabaseTransaction } from '../db/client.js'
import {
  deploymentSettings,
  organizationAuthorityEvidence,
  organizationCorporationSources,
  organizationManagedCorporations,
  organizationRoleGrants,
} from '../db/schema.js'

export type CharacterDetachmentBlocker = 'authority-evidence' | 'corporation-source'

export async function findCharacterDetachmentBlocker(
  transaction: DatabaseTransaction,
  characterId: number,
): Promise<CharacterDetachmentBlocker | null> {
  const [retainedAuthorityEvidence] = await transaction
    .select({ evidenceId: organizationAuthorityEvidence.evidenceId })
    .from(organizationAuthorityEvidence)
    .innerJoin(
      organizationRoleGrants,
      eq(organizationRoleGrants.grantId, organizationAuthorityEvidence.grantId),
    )
    .where(
      and(
        eq(organizationAuthorityEvidence.characterId, characterId),
        isNull(organizationRoleGrants.revokedAt),
      ),
    )
    .limit(1)
  if (retainedAuthorityEvidence) return 'authority-evidence'

  const [activeCorporationSource] = await transaction
    .select({ sourceId: organizationCorporationSources.sourceId })
    .from(organizationCorporationSources)
    .innerJoin(
      deploymentSettings,
      and(
        eq(deploymentSettings.id, organizationCorporationSources.deploymentId),
        eq(
          deploymentSettings.organizationVersion,
          organizationCorporationSources.organizationVersion,
        ),
      ),
    )
    .innerJoin(
      organizationManagedCorporations,
      and(
        eq(
          organizationManagedCorporations.deploymentId,
          organizationCorporationSources.deploymentId,
        ),
        eq(
          organizationManagedCorporations.organizationVersion,
          organizationCorporationSources.organizationVersion,
        ),
        eq(
          organizationManagedCorporations.corporationId,
          organizationCorporationSources.corporationId,
        ),
        eq(organizationManagedCorporations.isCurrent, true),
      ),
    )
    .where(
      and(
        eq(organizationCorporationSources.characterId, characterId),
        isNull(organizationCorporationSources.revokedAt),
      ),
    )
    .for('update')
    .limit(1)
  return activeCorporationSource ? 'corporation-source' : null
}
