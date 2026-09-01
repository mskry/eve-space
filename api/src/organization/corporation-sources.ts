import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  eveTokens,
  organizationCorporationSources,
  organizationManagedCorporations,
  platformSubjectLifecycles,
} from '../db/schema.js'
import { getCharacterEsiScope } from '../esi-resilience/catalog.js'
import { appendOrganizationAuditEvent } from './audit.js'
import { loadManagementAuthority } from './group-store.js'

export const corporationMembershipScope = getCharacterEsiScope('corporation-members')

export class OrganizationCorporationSourceMutationError extends Error {
  constructor(
    readonly code:
      | 'manager-authority-required'
      | 'corporation-not-managed'
      | 'source-character-ineligible',
  ) {
    super(code)
  }
}

export async function registerOrganizationCorporationSource(input: {
  actorUserId: string
  corporationId: number
  characterId: number
}) {
  return db.transaction(async (transaction) => {
    const [organization] = await transaction
      .select({
        organizationVersion: deploymentSettings.organizationVersion,
        policyVersion: deploymentSettings.registrationPolicyVersion,
      })
      .from(deploymentSettings)
      .where(eq(deploymentSettings.id, 1))
      .for('update')
    if (!organization) throw new Error('Deployment organization is not configured')
    if (
      !(await loadManagementAuthority(
        transaction,
        organization.organizationVersion,
        input.actorUserId,
      ))
    )
      throw new OrganizationCorporationSourceMutationError('manager-authority-required')

    const [managed] = await transaction
      .select({ corporationId: organizationManagedCorporations.corporationId })
      .from(organizationManagedCorporations)
      .where(
        and(
          eq(organizationManagedCorporations.deploymentId, 1),
          eq(organizationManagedCorporations.organizationVersion, organization.organizationVersion),
          eq(organizationManagedCorporations.corporationId, input.corporationId),
          eq(organizationManagedCorporations.isCurrent, true),
        ),
      )
    if (!managed) throw new OrganizationCorporationSourceMutationError('corporation-not-managed')

    const [character] = await transaction
      .select({
        userId: characters.userId,
        corporationId: characters.corporationId,
        affiliationCheckedAt: characters.affiliationCheckedAt,
        affiliationResolutionState: characters.affiliationResolutionState,
        scopes: eveTokens.scopes,
      })
      .from(characters)
      .innerJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
      .where(eq(characters.characterId, input.characterId))
      .for('update')
    if (
      character?.userId !== input.actorUserId ||
      character.corporationId !== input.corporationId ||
      character.affiliationResolutionState !== 'resolved' ||
      !character.affiliationCheckedAt ||
      !character.scopes.includes(corporationMembershipScope)
    )
      throw new OrganizationCorporationSourceMutationError('source-character-ineligible')

    const [existing] = await transaction
      .select()
      .from(organizationCorporationSources)
      .where(
        and(
          eq(organizationCorporationSources.deploymentId, 1),
          eq(organizationCorporationSources.organizationVersion, organization.organizationVersion),
          eq(organizationCorporationSources.corporationId, input.corporationId),
          isNull(organizationCorporationSources.revokedAt),
        ),
      )
      .for('update')
    if (existing?.characterId === input.characterId)
      return { source: toCorporationSource(existing), replaced: false }

    const now = new Date()
    if (existing)
      await transaction
        .update(organizationCorporationSources)
        .set({
          revokedAt: now,
          revokedByUserId: input.actorUserId,
          revocationReason: 'Replaced by a newly selected corporation data source.',
          updatedAt: now,
        })
        .where(eq(organizationCorporationSources.sourceId, existing.sourceId))
    const [source] = await transaction
      .insert(organizationCorporationSources)
      .values({
        deploymentId: 1,
        organizationVersion: organization.organizationVersion,
        corporationId: input.corporationId,
        characterId: input.characterId,
        evidenceCharacterId: input.characterId,
        registeredByUserId: input.actorUserId,
        registeredAt: now,
      })
      .returning()
    if (!source) throw new Error('Failed to register corporation data source')
    await transaction.insert(platformSubjectLifecycles).values({
      subjectKind: 'corporation',
      subjectId: String(input.corporationId),
      corporationSourceId: source.sourceId,
      createdAt: now,
    })
    await appendOrganizationAuditEvent(transaction, {
      deploymentId: 1,
      organizationVersion: organization.organizationVersion,
      policyVersion: organization.policyVersion,
      eventType: existing ? 'corporation-source.replaced' : 'corporation-source.registered',
      actorType: 'user',
      actorId: input.actorUserId,
      subjectType: 'corporation_source',
      subjectId: source.sourceId,
      reason: existing
        ? 'The corporation data-source character was replaced.'
        : 'A corporation data-source character was registered.',
      outcome: existing ? 'transitioned' : 'granted',
      occurredAt: now,
    })
    return { source: toCorporationSource(source), replaced: Boolean(existing) }
  })
}

function toCorporationSource(source: typeof organizationCorporationSources.$inferSelect) {
  return {
    sourceId: source.sourceId,
    organizationVersion: source.organizationVersion,
    corporationId: source.corporationId,
    characterId: source.characterId,
    evidenceCharacterId: source.evidenceCharacterId,
    registeredByUserId: source.registeredByUserId,
    registeredAt: source.registeredAt.toISOString(),
  }
}
