import { and, asc, eq, isNull, notExists, or, sql } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  organizationAuthorityEvidence,
  organizationCorporationSources,
  organizationDerivedAuthoritySources,
  organizationMemberBlocks,
  organizationRoleGrants,
  users,
  type ElevatedOrganizationRole,
} from '../db/schema.js'
import { appendOrganizationAuditEvent } from './audit.js'
import {
  resolveAuthorityEvidenceState,
  type AuthorityEvidenceState,
  type AuthorityOperation,
} from './authority-policy.js'
import { hasCurrentComplianceAccess } from './compliance-access.js'
import {
  loadEffectiveOrganizationAuthority,
  type EffectiveAuthorityLoadOptions,
} from './effective-authority.js'
import { lockCurrentOrganization } from './organization-lock.js'
import { isOrganizationOwnerClaimAvailable } from './owner-claim-policy.js'

export type DelegatedOrganizationRole = Exclude<ElevatedOrganizationRole, 'organization_owner'>
type Database = DatabaseTransaction | typeof db
type Transaction = DatabaseTransaction

export class OrganizationRoleMutationError extends Error {
  constructor(
    readonly code:
      | 'owner-authority-required'
      | 'target-not-found'
      | 'role-already-granted'
      | 'grant-not-found',
  ) {
    super(code)
  }
}

export function hasCurrentOrganizationOwnerAuthority(
  userId: string,
  now = new Date(),
  operation: AuthorityOperation = 'read-continuity',
) {
  return hasCurrentOrganizationOwnerAuthorityInTransaction(db, userId, now, operation)
}

export async function loadCurrentOrganizationAuthorityForUser(
  userId: string,
  now = new Date(),
  operation: AuthorityOperation = 'read-continuity',
) {
  const [organization] = await db
    .select({ organizationVersion: deploymentSettings.organizationVersion })
    .from(deploymentSettings)
    .where(eq(deploymentSettings.id, 1))
  if (!organization) return null
  return loadEffectiveOrganizationAuthority(
    db,
    organization.organizationVersion,
    userId,
    operation,
    now,
  )
}

export async function hasCurrentOrganizationOwnerAuthorityInTransaction(
  database: Database,
  userId: string,
  now = new Date(),
  operation: AuthorityOperation = 'read-continuity',
  options: EffectiveAuthorityLoadOptions = {},
) {
  const [organization] = await database
    .select({ organizationVersion: deploymentSettings.organizationVersion })
    .from(deploymentSettings)
    .where(eq(deploymentSettings.id, 1))
  if (!organization) return false
  const authority = await loadEffectiveOrganizationAuthority(
    database,
    organization.organizationVersion,
    userId,
    operation,
    now,
    options,
  )
  return authority.organizationOwner
}

export async function hasCurrentOrganizationHrAuthority(userId: string) {
  const [grant] = await db
    .select({ grantId: organizationRoleGrants.grantId })
    .from(deploymentSettings)
    .innerJoin(
      organizationRoleGrants,
      and(
        eq(organizationRoleGrants.deploymentId, deploymentSettings.id),
        eq(organizationRoleGrants.organizationVersion, deploymentSettings.organizationVersion),
      ),
    )
    .where(
      and(
        eq(deploymentSettings.id, 1),
        eq(organizationRoleGrants.userId, userId),
        eq(organizationRoleGrants.role, 'hr_auditor'),
        isNull(organizationRoleGrants.revokedAt),
        notExists(
          db
            .select({ one: sql`1` })
            .from(organizationMemberBlocks)
            .where(
              and(
                eq(organizationMemberBlocks.deploymentId, deploymentSettings.id),
                eq(
                  organizationMemberBlocks.organizationVersion,
                  deploymentSettings.organizationVersion,
                ),
                eq(organizationMemberBlocks.userId, userId),
                isNull(organizationMemberBlocks.unblockedAt),
              ),
            ),
        ),
      ),
    )
    .limit(1)
  return Boolean(grant)
}

export async function getOrganizationAccessContext(userId: string) {
  const now = new Date()
  const [organization] = await db
    .select({
      organizationType: deploymentSettings.organizationType,
      organizationId: deploymentSettings.organizationId,
      organizationName: deploymentSettings.organizationName,
      organizationTicker: deploymentSettings.organizationTicker,
      organizationVersion: deploymentSettings.organizationVersion,
    })
    .from(deploymentSettings)
    .where(eq(deploymentSettings.id, 1))
  if (!organization) throw new Error('Deployment organization is not configured')

  const [owner] = await db
    .select({
      userId: organizationRoleGrants.userId,
      status: organizationAuthorityEvidence.status,
      freshUntil: organizationAuthorityEvidence.freshUntil,
      graceUntil: organizationAuthorityEvidence.graceUntil,
      invalidatedAt: organizationAuthorityEvidence.invalidatedAt,
      failureClass: organizationAuthorityEvidence.failureClass,
      characterId: organizationAuthorityEvidence.characterId,
      characterName: characters.name,
      authorityCorporationId: organizationAuthorityEvidence.authorityCorporationId,
      observedAt: organizationAuthorityEvidence.observedAt,
      lastCheckedAt: organizationAuthorityEvidence.lastCheckedAt,
    })
    .from(organizationRoleGrants)
    .leftJoin(
      organizationAuthorityEvidence,
      eq(organizationAuthorityEvidence.grantId, organizationRoleGrants.grantId),
    )
    .leftJoin(characters, eq(characters.characterId, organizationAuthorityEvidence.characterId))
    .where(
      and(
        eq(organizationRoleGrants.deploymentId, 1),
        eq(organizationRoleGrants.organizationVersion, organization.organizationVersion),
        eq(organizationRoleGrants.role, 'organization_owner'),
        isNull(organizationRoleGrants.revokedAt),
      ),
    )
    .limit(1)
  const authority = await loadEffectiveOrganizationAuthority(
    db,
    organization.organizationVersion,
    userId,
    'read-continuity',
    now,
  )
  const isOrganizationOwner = authority.organizationOwner
  const hasHrAuthority = await hasCurrentOrganizationHrAuthority(userId)
  const canViewRosterCoverage =
    hasHrAuthority &&
    (await hasCurrentComplianceAccess(db, organization.organizationVersion, userId))
  const [memberBlock] = await db
    .select({ blockId: organizationMemberBlocks.blockId })
    .from(organizationMemberBlocks)
    .where(
      and(
        eq(organizationMemberBlocks.deploymentId, 1),
        eq(organizationMemberBlocks.organizationVersion, organization.organizationVersion),
        eq(organizationMemberBlocks.userId, userId),
        isNull(organizationMemberBlocks.unblockedAt),
      ),
    )
    .limit(1)
  const isBlocked = Boolean(memberBlock)
  const claimAvailable = !isBlocked && isOrganizationOwnerClaimAvailable(owner, now)
  const ownerStatus =
    owner?.status && owner.freshUntil
      ? effectiveSourceStatus(
          {
            status: owner.status,
            freshUntil: owner.freshUntil,
            graceUntil: owner.graceUntil,
            invalidatedAt: owner.invalidatedAt,
          },
          now,
        )
      : null

  return {
    organization,
    isOrganizationOwner,
    isBlocked,
    capabilities: {
      reviewRegistration: canViewRosterCoverage,
      viewRosterCoverage: canViewRosterCoverage,
    },
    claimAvailable,
    ownerStatus,
    ownerFailureClass:
      ownerStatus === 'invalid'
        ? (owner?.failureClass ?? 'strict:expired')
        : (owner?.failureClass ?? null),
    freshUntil: owner?.freshUntil?.toISOString() ?? null,
    graceUntil: owner?.graceUntil?.toISOString() ?? null,
    authorityCharacter:
      owner?.userId === userId && owner.characterId && owner.characterName
        ? {
            characterId: owner.characterId,
            name: owner.characterName,
            sourceType: 'designated-owner' as const,
            corporationId: owner.authorityCorporationId,
            observedAt: owner.observedAt?.toISOString() ?? null,
            freshUntil: owner.freshUntil?.toISOString() ?? null,
            graceUntil: owner.graceUntil?.toISOString() ?? null,
            lastCheckedAt: owner.lastCheckedAt?.toISOString() ?? null,
          }
        : null,
  }
}

export async function listCurrentOrganizationRoles() {
  const now = new Date()
  const [organization] = await db
    .select({ organizationVersion: deploymentSettings.organizationVersion })
    .from(deploymentSettings)
    .where(eq(deploymentSettings.id, 1))
  if (!organization) throw new Error('Deployment organization is not configured')

  const grants = await db
    .select({
      grantId: organizationRoleGrants.grantId,
      userId: organizationRoleGrants.userId,
      role: organizationRoleGrants.role,
      reason: organizationRoleGrants.reason,
      grantedByUserId: organizationRoleGrants.grantedByUserId,
      grantedAt: organizationRoleGrants.grantedAt,
      mainCharacterId: characters.characterId,
      mainCharacterName: characters.name,
    })
    .from(organizationRoleGrants)
    .leftJoin(
      characters,
      and(eq(characters.userId, organizationRoleGrants.userId), eq(characters.isMain, true)),
    )
    .where(
      and(
        eq(organizationRoleGrants.deploymentId, 1),
        eq(organizationRoleGrants.organizationVersion, organization.organizationVersion),
        or(
          eq(organizationRoleGrants.role, 'hr_auditor'),
          eq(organizationRoleGrants.role, 'director'),
        ),
        isNull(organizationRoleGrants.revokedAt),
      ),
    )
    .orderBy(asc(organizationRoleGrants.role), asc(organizationRoleGrants.grantedAt))

  const derivedSources = await db
    .select({
      sourceId: organizationDerivedAuthoritySources.sourceId,
      userId: organizationDerivedAuthoritySources.userId,
      characterId: organizationDerivedAuthoritySources.characterId,
      characterName: characters.name,
      sourceSubjectLifecycleId: organizationDerivedAuthoritySources.sourceSubjectLifecycleId,
      authorizationGeneration: organizationDerivedAuthoritySources.authorizationGeneration,
      authorityCorporationId: organizationDerivedAuthoritySources.authorityCorporationId,
      observedCorporationId: organizationDerivedAuthoritySources.observedCorporationId,
      observedAllianceId: organizationDerivedAuthoritySources.observedAllianceId,
      requiredScope: organizationDerivedAuthoritySources.requiredScope,
      roleEvidenceRevision: organizationDerivedAuthoritySources.roleEvidenceRevision,
      status: organizationDerivedAuthoritySources.status,
      observedAt: organizationDerivedAuthoritySources.observedAt,
      freshUntil: organizationDerivedAuthoritySources.freshUntil,
      graceUntil: organizationDerivedAuthoritySources.graceUntil,
      failureClass: organizationDerivedAuthoritySources.failureClass,
      invalidatedAt: organizationDerivedAuthoritySources.invalidatedAt,
      invalidationOutcome: organizationDerivedAuthoritySources.invalidationOutcome,
    })
    .from(organizationDerivedAuthoritySources)
    .leftJoin(
      characters,
      eq(characters.characterId, organizationDerivedAuthoritySources.characterId),
    )
    .where(
      and(
        eq(organizationDerivedAuthoritySources.deploymentId, 1),
        eq(
          organizationDerivedAuthoritySources.organizationVersion,
          organization.organizationVersion,
        ),
      ),
    )
    .orderBy(
      asc(organizationDerivedAuthoritySources.userId),
      asc(organizationDerivedAuthoritySources.characterId),
      asc(organizationDerivedAuthoritySources.observedAt),
    )

  const ownerSources = await db
    .select({
      sourceId: organizationAuthorityEvidence.evidenceId,
      grantId: organizationAuthorityEvidence.grantId,
      userId: organizationAuthorityEvidence.userId,
      characterId: organizationAuthorityEvidence.characterId,
      characterName: characters.name,
      sourceSubjectLifecycleId: organizationAuthorityEvidence.sourceSubjectLifecycleId,
      authorizationGeneration: organizationAuthorityEvidence.authorizationGeneration,
      authorityCorporationId: organizationAuthorityEvidence.authorityCorporationId,
      observedCorporationId: organizationAuthorityEvidence.observedCorporationId,
      observedAllianceId: organizationAuthorityEvidence.observedAllianceId,
      requiredScope: organizationAuthorityEvidence.requiredScope,
      roleEvidenceRevision: organizationAuthorityEvidence.roleEvidenceRevision,
      status: organizationAuthorityEvidence.status,
      observedAt: organizationAuthorityEvidence.observedAt,
      freshUntil: organizationAuthorityEvidence.freshUntil,
      graceUntil: organizationAuthorityEvidence.graceUntil,
      failureClass: organizationAuthorityEvidence.failureClass,
      invalidatedAt: organizationAuthorityEvidence.invalidatedAt,
      invalidationOutcome: organizationAuthorityEvidence.invalidationOutcome,
      grantRevokedAt: organizationRoleGrants.revokedAt,
    })
    .from(organizationAuthorityEvidence)
    .innerJoin(
      organizationRoleGrants,
      eq(organizationRoleGrants.grantId, organizationAuthorityEvidence.grantId),
    )
    .leftJoin(characters, eq(characters.characterId, organizationAuthorityEvidence.characterId))
    .where(
      and(
        eq(organizationAuthorityEvidence.deploymentId, 1),
        eq(organizationAuthorityEvidence.organizationVersion, organization.organizationVersion),
      ),
    )
    .orderBy(
      asc(organizationAuthorityEvidence.userId),
      asc(organizationAuthorityEvidence.observedAt),
    )

  const corporationSources = await db
    .select({
      sourceId: organizationCorporationSources.sourceId,
      corporationId: organizationCorporationSources.corporationId,
      userId: organizationCorporationSources.sourceUserId,
      characterId: organizationCorporationSources.evidenceCharacterId,
      characterName: characters.name,
      sourceSubjectLifecycleId: organizationCorporationSources.sourceSubjectLifecycleId,
      authorizationGeneration: organizationCorporationSources.authorizationGeneration,
      observedCorporationId: organizationCorporationSources.observedCorporationId,
      observedAllianceId: organizationCorporationSources.observedAllianceId,
      requiredScope: organizationCorporationSources.requiredScope,
      roleEvidenceRevision: organizationCorporationSources.roleEvidenceRevision,
      status: organizationCorporationSources.status,
      observedAt: organizationCorporationSources.observedAt,
      freshUntil: organizationCorporationSources.freshUntil,
      graceUntil: organizationCorporationSources.graceUntil,
      failureClass: organizationCorporationSources.failureClass,
      invalidatedAt: organizationCorporationSources.invalidatedAt,
      invalidationOutcome: organizationCorporationSources.invalidationOutcome,
      registeredAt: organizationCorporationSources.registeredAt,
      revokedAt: organizationCorporationSources.revokedAt,
    })
    .from(organizationCorporationSources)
    .leftJoin(
      characters,
      eq(characters.characterId, organizationCorporationSources.evidenceCharacterId),
    )
    .where(
      and(
        eq(organizationCorporationSources.deploymentId, 1),
        eq(organizationCorporationSources.organizationVersion, organization.organizationVersion),
      ),
    )
    .orderBy(
      asc(organizationCorporationSources.corporationId),
      asc(organizationCorporationSources.registeredAt),
    )

  return {
    grants: grants.map((grant) => ({
      grantId: grant.grantId,
      origin: 'explicit' as const,
      userId: grant.userId,
      role: grant.role as DelegatedOrganizationRole,
      reason: grant.reason,
      grantedByUserId: grant.grantedByUserId,
      grantedAt: grant.grantedAt.toISOString(),
      mainCharacterId: grant.mainCharacterId,
      mainCharacterName: grant.mainCharacterName,
    })),
    derivedSources: derivedSources.map((source) => {
      const status = effectiveSourceStatus(source, now)
      return {
        sourceId: source.sourceId,
        userId: source.userId,
        role: 'director' as const,
        origin: 'eve-derived' as const,
        characterId: source.characterId,
        characterName: source.characterName,
        sourceSubjectLifecycleId: source.sourceSubjectLifecycleId,
        authorizationGeneration: source.authorizationGeneration,
        authorityCorporationId: source.authorityCorporationId,
        observedCorporationId: source.observedCorporationId,
        observedAllianceId: source.observedAllianceId,
        requiredScope: source.requiredScope,
        roleEvidenceRevision: source.roleEvidenceRevision,
        status,
        observedAt: source.observedAt.toISOString(),
        freshUntil: source.freshUntil.toISOString(),
        graceUntil: source.graceUntil?.toISOString() ?? null,
        failureClass: effectiveFailureClass(status, source.failureClass),
        invalidatedAt: source.invalidatedAt?.toISOString() ?? null,
        invalidationOutcome: source.invalidationOutcome,
        remediationAction: status === 'fresh' ? null : ('reauthorize-character' as const),
      }
    }),
    ownerSources: ownerSources.map((source) => {
      const status = effectiveSourceStatus(
        { ...source, invalidatedAt: source.invalidatedAt ?? source.grantRevokedAt },
        now,
      )
      return {
        sourceId: source.sourceId,
        grantId: source.grantId,
        userId: source.userId,
        role: 'organization_owner' as const,
        origin: 'designated-owner' as const,
        characterId: source.characterId,
        characterName: source.characterName,
        sourceSubjectLifecycleId: source.sourceSubjectLifecycleId,
        authorizationGeneration: source.authorizationGeneration,
        authorityCorporationId: source.authorityCorporationId,
        observedCorporationId: source.observedCorporationId,
        observedAllianceId: source.observedAllianceId,
        requiredScope: source.requiredScope,
        roleEvidenceRevision: source.roleEvidenceRevision,
        status,
        observedAt: source.observedAt.toISOString(),
        freshUntil: source.freshUntil.toISOString(),
        graceUntil: source.graceUntil?.toISOString() ?? null,
        failureClass: effectiveFailureClass(status, source.failureClass),
        invalidatedAt: source.invalidatedAt?.toISOString() ?? null,
        invalidationOutcome: source.invalidationOutcome,
        grantRevokedAt: source.grantRevokedAt?.toISOString() ?? null,
        remediationAction:
          status === 'fresh' ? null : ('replace-or-reauthorize-owner-source' as const),
      }
    }),
    corporationSources: corporationSources.map((source) => {
      const status = effectiveSourceStatus(
        { ...source, invalidatedAt: source.invalidatedAt ?? source.revokedAt },
        now,
      )
      return {
        sourceId: source.sourceId,
        corporationId: source.corporationId,
        userId: source.userId,
        origin: 'designated-corporation' as const,
        characterId: source.characterId,
        characterName: source.characterName,
        sourceSubjectLifecycleId: source.sourceSubjectLifecycleId,
        authorizationGeneration: source.authorizationGeneration,
        observedCorporationId: source.observedCorporationId,
        observedAllianceId: source.observedAllianceId,
        requiredScope: source.requiredScope,
        roleEvidenceRevision: source.roleEvidenceRevision,
        status,
        observedAt: source.observedAt.toISOString(),
        freshUntil: source.freshUntil.toISOString(),
        graceUntil: source.graceUntil?.toISOString() ?? null,
        failureClass: effectiveFailureClass(status, source.failureClass),
        invalidatedAt: source.invalidatedAt?.toISOString() ?? null,
        invalidationOutcome: source.invalidationOutcome,
        registeredAt: source.registeredAt.toISOString(),
        revokedAt: source.revokedAt?.toISOString() ?? null,
        remediationAction: status === 'fresh' ? null : ('replace-corporation-source' as const),
      }
    }),
  }
}

export async function grantOrganizationRole(input: {
  actorUserId: string
  targetUserId: string
  role: DelegatedOrganizationRole
  reason: string
}) {
  return db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction)
    await requireOwnerAuthority(transaction, organization.organizationVersion, input.actorUserId)

    const [target] = await transaction
      .select({ userId: users.id })
      .from(users)
      .where(eq(users.id, input.targetUserId))
    if (!target) throw new OrganizationRoleMutationError('target-not-found')

    const [existing] = await transaction
      .select({ grantId: organizationRoleGrants.grantId })
      .from(organizationRoleGrants)
      .where(
        and(
          eq(organizationRoleGrants.deploymentId, 1),
          eq(organizationRoleGrants.organizationVersion, organization.organizationVersion),
          eq(organizationRoleGrants.userId, input.targetUserId),
          eq(organizationRoleGrants.role, input.role),
          isNull(organizationRoleGrants.revokedAt),
        ),
      )
    if (existing) throw new OrganizationRoleMutationError('role-already-granted')

    const now = new Date()
    const [grant] = await transaction
      .insert(organizationRoleGrants)
      .values({
        deploymentId: 1,
        organizationVersion: organization.organizationVersion,
        userId: input.targetUserId,
        role: input.role,
        grantedByUserId: input.actorUserId,
        reason: input.reason,
        grantedAt: now,
      })
      .returning()
    if (!grant) throw new Error('Failed to create organization role grant')
    await appendOrganizationAuditEvent(transaction, {
      deploymentId: 1,
      organizationVersion: organization.organizationVersion,
      policyVersion: organization.policyVersion,
      eventType: 'role.granted',
      actorType: 'user',
      actorId: input.actorUserId,
      subjectType: 'role_grant',
      subjectId: grant.grantId,
      reason: input.reason,
      outcome: 'granted',
      occurredAt: now,
    })
    return toRoleGrant(grant)
  })
}

export async function revokeOrganizationRole(input: {
  actorUserId: string
  grantId: string
  reason: string
}) {
  return db.transaction(async (transaction) => {
    const organization = await lockCurrentOrganization(transaction)
    await requireOwnerAuthority(transaction, organization.organizationVersion, input.actorUserId)
    const [grant] = await transaction
      .select()
      .from(organizationRoleGrants)
      .where(
        and(
          eq(organizationRoleGrants.grantId, input.grantId),
          eq(organizationRoleGrants.deploymentId, 1),
          eq(organizationRoleGrants.organizationVersion, organization.organizationVersion),
          or(
            eq(organizationRoleGrants.role, 'hr_auditor'),
            eq(organizationRoleGrants.role, 'director'),
          ),
          isNull(organizationRoleGrants.revokedAt),
        ),
      )
      .for('update')
    if (!grant) throw new OrganizationRoleMutationError('grant-not-found')

    const now = new Date()
    const [revoked] = await transaction
      .update(organizationRoleGrants)
      .set({
        revokedAt: now,
        revokedByUserId: input.actorUserId,
        revocationReason: input.reason,
        updatedAt: now,
      })
      .where(eq(organizationRoleGrants.grantId, grant.grantId))
      .returning()
    if (!revoked) throw new Error('Failed to revoke organization role grant')
    await appendOrganizationAuditEvent(transaction, {
      deploymentId: 1,
      organizationVersion: organization.organizationVersion,
      policyVersion: organization.policyVersion,
      eventType: 'role.revoked',
      actorType: 'user',
      actorId: input.actorUserId,
      subjectType: 'role_grant',
      subjectId: grant.grantId,
      reason: input.reason,
      outcome: 'revoked',
      occurredAt: now,
    })
    return toRoleGrant(revoked)
  })
}

async function requireOwnerAuthority(
  transaction: Transaction,
  organizationVersion: number,
  userId: string,
) {
  const authority = await loadEffectiveOrganizationAuthority(
    transaction,
    organizationVersion,
    userId,
    'mutate',
  )
  if (!authority.organizationOwner)
    throw new OrganizationRoleMutationError('owner-authority-required')
}

function toRoleGrant(grant: typeof organizationRoleGrants.$inferSelect) {
  return {
    grantId: grant.grantId,
    organizationVersion: grant.organizationVersion,
    userId: grant.userId,
    role: grant.role,
    reason: grant.reason,
    grantedByUserId: grant.grantedByUserId,
    grantedAt: grant.grantedAt.toISOString(),
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    revokedByUserId: grant.revokedByUserId,
    revocationReason: grant.revocationReason,
  }
}

function effectiveSourceStatus(
  source: {
    status: AuthorityEvidenceState
    freshUntil: Date
    graceUntil: Date | null
    invalidatedAt: Date | null
  },
  now: Date,
) {
  return resolveAuthorityEvidenceState(source, now)
}

function effectiveFailureClass(status: AuthorityEvidenceState, failureClass: string | null) {
  if (status !== 'invalid') return failureClass
  return failureClass ?? 'strict:expired'
}
