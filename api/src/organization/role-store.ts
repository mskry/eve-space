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
  if (!organization) {
    return null
  }
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
  if (!organization) {
    return false
  }
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
      organizationId: deploymentSettings.organizationId,
      organizationName: deploymentSettings.organizationName,
      organizationTicker: deploymentSettings.organizationTicker,
      organizationType: deploymentSettings.organizationType,
      organizationVersion: deploymentSettings.organizationVersion,
    })
    .from(deploymentSettings)
    .where(eq(deploymentSettings.id, 1))
  if (!organization) {
    throw new Error('Deployment organization is not configured')
  }

  const owner = await loadOwnerAccessRecord(organization.organizationVersion)
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
  return {
    capabilities: {
      reviewRegistration: canViewRosterCoverage,
      viewRosterCoverage: canViewRosterCoverage,
    },
    claimAvailable,
    isBlocked,
    isOrganizationOwner,
    organization,
    ...ownerAccessDetails(owner, userId, now),
  }
}

async function loadOwnerAccessRecord(organizationVersion: number) {
  const [owner] = await db
    .select({
      authorityCorporationId: organizationAuthorityEvidence.authorityCorporationId,
      characterId: organizationAuthorityEvidence.characterId,
      characterName: characters.name,
      failureClass: organizationAuthorityEvidence.failureClass,
      freshUntil: organizationAuthorityEvidence.freshUntil,
      graceUntil: organizationAuthorityEvidence.graceUntil,
      invalidatedAt: organizationAuthorityEvidence.invalidatedAt,
      lastCheckedAt: organizationAuthorityEvidence.lastCheckedAt,
      observedAt: organizationAuthorityEvidence.observedAt,
      status: organizationAuthorityEvidence.status,
      userId: organizationRoleGrants.userId,
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
        eq(organizationRoleGrants.organizationVersion, organizationVersion),
        eq(organizationRoleGrants.role, 'organization_owner'),
        isNull(organizationRoleGrants.revokedAt),
      ),
    )
    .limit(1)
  return owner
}

function ownerAccessDetails(
  owner: Awaited<ReturnType<typeof loadOwnerAccessRecord>>,
  userId: string,
  now: Date,
) {
  const ownerStatus = ownerSourceStatus(owner, now)
  return {
    authorityCharacter: ownerCharacterDetails(owner, userId),
    freshUntil: owner?.freshUntil?.toISOString() ?? null,
    graceUntil: owner?.graceUntil?.toISOString() ?? null,
    ownerFailureClass:
      ownerStatus === 'invalid'
        ? (owner?.failureClass ?? 'strict:expired')
        : (owner?.failureClass ?? null),
    ownerStatus,
  }
}

function ownerSourceStatus(owner: Awaited<ReturnType<typeof loadOwnerAccessRecord>>, now: Date) {
  return owner?.status && owner.freshUntil
    ? effectiveSourceStatus(
        {
          freshUntil: owner.freshUntil,
          graceUntil: owner.graceUntil,
          invalidatedAt: owner.invalidatedAt,
          status: owner.status,
        },
        now,
      )
    : null
}

function ownerCharacterDetails(
  owner: Awaited<ReturnType<typeof loadOwnerAccessRecord>>,
  userId: string,
) {
  return owner?.userId === userId && owner.characterId && owner.characterName
    ? {
        characterId: owner.characterId,
        corporationId: owner.authorityCorporationId,
        freshUntil: owner.freshUntil?.toISOString() ?? null,
        graceUntil: owner.graceUntil?.toISOString() ?? null,
        lastCheckedAt: owner.lastCheckedAt?.toISOString() ?? null,
        name: owner.characterName,
        observedAt: owner.observedAt?.toISOString() ?? null,
        sourceType: 'designated-owner' as const,
      }
    : null
}

export async function listCurrentOrganizationRoles() {
  const now = new Date()
  const [organization] = await db
    .select({ organizationVersion: deploymentSettings.organizationVersion })
    .from(deploymentSettings)
    .where(eq(deploymentSettings.id, 1))
  if (!organization) {
    throw new Error('Deployment organization is not configured')
  }

  const grants = await db
    .select({
      grantId: organizationRoleGrants.grantId,
      grantedAt: organizationRoleGrants.grantedAt,
      grantedByUserId: organizationRoleGrants.grantedByUserId,
      mainCharacterId: characters.characterId,
      mainCharacterName: characters.name,
      reason: organizationRoleGrants.reason,
      role: organizationRoleGrants.role,
      userId: organizationRoleGrants.userId,
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
      authorityCorporationId: organizationDerivedAuthoritySources.authorityCorporationId,
      authorizationGeneration: organizationDerivedAuthoritySources.authorizationGeneration,
      characterId: organizationDerivedAuthoritySources.characterId,
      characterName: characters.name,
      failureClass: organizationDerivedAuthoritySources.failureClass,
      freshUntil: organizationDerivedAuthoritySources.freshUntil,
      graceUntil: organizationDerivedAuthoritySources.graceUntil,
      invalidatedAt: organizationDerivedAuthoritySources.invalidatedAt,
      invalidationOutcome: organizationDerivedAuthoritySources.invalidationOutcome,
      observedAllianceId: organizationDerivedAuthoritySources.observedAllianceId,
      observedAt: organizationDerivedAuthoritySources.observedAt,
      observedCorporationId: organizationDerivedAuthoritySources.observedCorporationId,
      requiredScope: organizationDerivedAuthoritySources.requiredScope,
      roleEvidenceRevision: organizationDerivedAuthoritySources.roleEvidenceRevision,
      sourceId: organizationDerivedAuthoritySources.sourceId,
      sourceSubjectLifecycleId: organizationDerivedAuthoritySources.sourceSubjectLifecycleId,
      status: organizationDerivedAuthoritySources.status,
      userId: organizationDerivedAuthoritySources.userId,
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
      authorityCorporationId: organizationAuthorityEvidence.authorityCorporationId,
      authorizationGeneration: organizationAuthorityEvidence.authorizationGeneration,
      characterId: organizationAuthorityEvidence.characterId,
      characterName: characters.name,
      failureClass: organizationAuthorityEvidence.failureClass,
      freshUntil: organizationAuthorityEvidence.freshUntil,
      graceUntil: organizationAuthorityEvidence.graceUntil,
      grantId: organizationAuthorityEvidence.grantId,
      grantRevokedAt: organizationRoleGrants.revokedAt,
      invalidatedAt: organizationAuthorityEvidence.invalidatedAt,
      invalidationOutcome: organizationAuthorityEvidence.invalidationOutcome,
      observedAllianceId: organizationAuthorityEvidence.observedAllianceId,
      observedAt: organizationAuthorityEvidence.observedAt,
      observedCorporationId: organizationAuthorityEvidence.observedCorporationId,
      requiredScope: organizationAuthorityEvidence.requiredScope,
      roleEvidenceRevision: organizationAuthorityEvidence.roleEvidenceRevision,
      sourceId: organizationAuthorityEvidence.evidenceId,
      sourceSubjectLifecycleId: organizationAuthorityEvidence.sourceSubjectLifecycleId,
      status: organizationAuthorityEvidence.status,
      userId: organizationAuthorityEvidence.userId,
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
      authorizationGeneration: organizationCorporationSources.authorizationGeneration,
      characterId: organizationCorporationSources.evidenceCharacterId,
      characterName: characters.name,
      corporationId: organizationCorporationSources.corporationId,
      failureClass: organizationCorporationSources.failureClass,
      freshUntil: organizationCorporationSources.freshUntil,
      graceUntil: organizationCorporationSources.graceUntil,
      invalidatedAt: organizationCorporationSources.invalidatedAt,
      invalidationOutcome: organizationCorporationSources.invalidationOutcome,
      observedAllianceId: organizationCorporationSources.observedAllianceId,
      observedAt: organizationCorporationSources.observedAt,
      observedCorporationId: organizationCorporationSources.observedCorporationId,
      registeredAt: organizationCorporationSources.registeredAt,
      requiredScope: organizationCorporationSources.requiredScope,
      revokedAt: organizationCorporationSources.revokedAt,
      roleEvidenceRevision: organizationCorporationSources.roleEvidenceRevision,
      sourceId: organizationCorporationSources.sourceId,
      sourceSubjectLifecycleId: organizationCorporationSources.sourceSubjectLifecycleId,
      status: organizationCorporationSources.status,
      userId: organizationCorporationSources.sourceUserId,
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
    if (!target) {
      throw new OrganizationRoleMutationError('target-not-found')
    }

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
    if (existing) {
      throw new OrganizationRoleMutationError('role-already-granted')
    }

    const now = new Date()
    const [grant] = await transaction
      .insert(organizationRoleGrants)
      .values({
        deploymentId: 1,
        grantedAt: now,
        grantedByUserId: input.actorUserId,
        organizationVersion: organization.organizationVersion,
        reason: input.reason,
        role: input.role,
        userId: input.targetUserId,
      })
      .returning()
    if (!grant) {
      throw new Error('Failed to create organization role grant')
    }
    await appendOrganizationAuditEvent(transaction, {
      actorId: input.actorUserId,
      actorType: 'user',
      deploymentId: 1,
      eventType: 'role.granted',
      occurredAt: now,
      organizationVersion: organization.organizationVersion,
      outcome: 'granted',
      policyVersion: organization.policyVersion,
      reason: input.reason,
      subjectId: grant.grantId,
      subjectType: 'role_grant',
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
    if (!grant) {
      throw new OrganizationRoleMutationError('grant-not-found')
    }

    const now = new Date()
    const [revoked] = await transaction
      .update(organizationRoleGrants)
      .set({
        revocationReason: input.reason,
        revokedAt: now,
        revokedByUserId: input.actorUserId,
        updatedAt: now,
      })
      .where(eq(organizationRoleGrants.grantId, grant.grantId))
      .returning()
    if (!revoked) {
      throw new Error('Failed to revoke organization role grant')
    }
    await appendOrganizationAuditEvent(transaction, {
      actorId: input.actorUserId,
      actorType: 'user',
      deploymentId: 1,
      eventType: 'role.revoked',
      occurredAt: now,
      organizationVersion: organization.organizationVersion,
      outcome: 'revoked',
      policyVersion: organization.policyVersion,
      reason: input.reason,
      subjectId: grant.grantId,
      subjectType: 'role_grant',
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
  if (!authority.organizationOwner) {
    throw new OrganizationRoleMutationError('owner-authority-required')
  }
}

function toRoleGrant(grant: typeof organizationRoleGrants.$inferSelect) {
  return {
    grantId: grant.grantId,
    grantedAt: grant.grantedAt.toISOString(),
    grantedByUserId: grant.grantedByUserId,
    organizationVersion: grant.organizationVersion,
    reason: grant.reason,
    revocationReason: grant.revocationReason,
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    revokedByUserId: grant.revokedByUserId,
    role: grant.role,
    userId: grant.userId,
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
  if (status !== 'invalid') {
    return failureClass
  }
  return failureClass ?? 'strict:expired'
}
