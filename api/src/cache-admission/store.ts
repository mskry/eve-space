import { and, asc, desc, eq, gt, inArray, isNull, ne, or } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  characters,
  deploymentModules,
  deploymentSettings,
  eveTokens,
  organizationAccountCompliance,
  organizationAuditEvents,
  organizationAuthorityEvidence,
  organizationDerivedAuthoritySources,
  organizationGroupAssignments,
  organizationGroupPermissionBundles,
  organizationGroups,
  organizationMemberBlocks,
  organizationPermissionBundleEntries,
  organizationRoleGrants,
  platformSubjectLifecycles,
} from '../db/schema.js'
import { installedModuleDefinitions } from '../generated/platform/installed-module-runtime.js'
import type { OrganizationSessionContext } from '../organization/access-policy.js'

export interface CharacterAdmissionFact {
  readonly characterId: number
  readonly subjectLifecycleId: string | null
  readonly tokenCharacterId: number | null
  readonly tokenVersion: number | null
  readonly scopes: string[] | null
}

interface ModuleAdmissionState {
  readonly moduleId: string
  readonly enabled: boolean
  readonly updatedAt: Date | null
}

export interface OrganizationAdmissionFoundation {
  readonly context: OrganizationSessionContext
  readonly registrationPolicyVersion: number
  readonly modules: readonly ModuleAdmissionState[]
}

export interface OrganizationRevisionFacts {
  readonly latestAuditSequence: string | null
  readonly roles: readonly {
    readonly grantId: string
    readonly role: string
    readonly grantedAt: string
    readonly evidenceStatus: string | null
    readonly evidenceReviewDeadline: string | null
    readonly evidenceValidUntil: string | null
  }[]
  readonly groups: readonly {
    readonly assignmentId: string
    readonly groupId: string
    readonly assignedAt: string
    readonly expiresAt: string | null
    readonly bundleId: string | null
    readonly permissionType: string | null
    readonly permissionKey: string | null
    readonly publisherPackage: string | null
    readonly moduleId: string | null
    readonly reviewAllowed: boolean | null
  }[]
}

export async function loadCharacterAdmissionFacts(userId: string) {
  return db
    .select({
      characterId: characters.characterId,
      subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
      tokenCharacterId: eveTokens.characterId,
      tokenVersion: eveTokens.tokenVersion,
      scopes: eveTokens.scopes,
    })
    .from(characters)
    .leftJoin(
      platformSubjectLifecycles,
      eq(platformSubjectLifecycles.characterId, characters.characterId),
    )
    .leftJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
    .where(eq(characters.userId, userId))
    .orderBy(asc(characters.characterId))
}

export async function loadOrganizationAdmissionFoundation(
  userId: string,
): Promise<OrganizationAdmissionFoundation | null> {
  const [organization] = await db
    .select({
      organizationVersion: deploymentSettings.organizationVersion,
      registrationPolicyVersion: deploymentSettings.registrationPolicyVersion,
      state: organizationAccountCompliance.state,
      evidenceFreshness: organizationAccountCompliance.evidenceFreshness,
      reviewDeadline: organizationAccountCompliance.reviewDeadline,
      accessValidUntil: organizationAccountCompliance.accessValidUntil,
      blockId: organizationMemberBlocks.blockId,
    })
    .from(deploymentSettings)
    .leftJoin(
      organizationAccountCompliance,
      and(
        eq(organizationAccountCompliance.deploymentId, deploymentSettings.id),
        eq(
          organizationAccountCompliance.organizationVersion,
          deploymentSettings.organizationVersion,
        ),
        eq(organizationAccountCompliance.userId, userId),
        eq(organizationAccountCompliance.authoritative, true),
      ),
    )
    .leftJoin(
      organizationMemberBlocks,
      and(
        eq(organizationMemberBlocks.deploymentId, deploymentSettings.id),
        eq(organizationMemberBlocks.organizationVersion, deploymentSettings.organizationVersion),
        eq(organizationMemberBlocks.userId, userId),
        isNull(organizationMemberBlocks.unblockedAt),
      ),
    )
    .where(eq(deploymentSettings.id, 1))
  if (!organization) return null

  const moduleIds = installedModuleDefinitions.map(({ moduleId }) => moduleId)
  const moduleRows =
    moduleIds.length === 0
      ? []
      : await db
          .select({
            moduleId: deploymentModules.moduleId,
            enabled: deploymentModules.enabled,
            updatedAt: deploymentModules.updatedAt,
          })
          .from(deploymentModules)
          .where(inArray(deploymentModules.moduleId, moduleIds))
  const modulesById = new Map(moduleRows.map((row) => [row.moduleId, row]))
  return {
    context: {
      organizationVersion: organization.organizationVersion,
      state: organization.state ?? 'pending',
      evidenceFreshness: organization.evidenceFreshness ?? 'unavailable',
      reviewDeadline: organization.reviewDeadline,
      accessValidUntil: organization.accessValidUntil,
      blocked: organization.blockId !== null,
    },
    registrationPolicyVersion: organization.registrationPolicyVersion,
    modules: moduleIds.map((moduleId) => {
      const row = modulesById.get(moduleId)
      return {
        moduleId,
        enabled: row?.enabled ?? false,
        updatedAt: row?.updatedAt ?? null,
      }
    }),
  }
}

export async function loadOrganizationRevisionFacts(
  userId: string,
  organizationVersion: number,
  now: Date,
): Promise<OrganizationRevisionFacts> {
  const [auditRows, roleRows, derivedRows, groupRows] = await Promise.all([
    db
      .select({ auditSequence: organizationAuditEvents.auditSequence })
      .from(organizationAuditEvents)
      .where(
        and(
          eq(organizationAuditEvents.deploymentId, 1),
          eq(organizationAuditEvents.organizationVersion, organizationVersion),
          ne(organizationAuditEvents.eventType, 'sensitive-access.decided'),
        ),
      )
      .orderBy(desc(organizationAuditEvents.auditSequence))
      .limit(1),
    db
      .select({
        grantId: organizationRoleGrants.grantId,
        role: organizationRoleGrants.role,
        grantedAt: organizationRoleGrants.grantedAt,
        evidenceStatus: organizationAuthorityEvidence.status,
        evidenceReviewDeadline: organizationAuthorityEvidence.graceUntil,
        evidenceFreshUntil: organizationAuthorityEvidence.freshUntil,
      })
      .from(organizationRoleGrants)
      .leftJoin(
        organizationAuthorityEvidence,
        eq(organizationAuthorityEvidence.grantId, organizationRoleGrants.grantId),
      )
      .where(
        and(
          eq(organizationRoleGrants.deploymentId, 1),
          eq(organizationRoleGrants.organizationVersion, organizationVersion),
          eq(organizationRoleGrants.userId, userId),
          isNull(organizationRoleGrants.revokedAt),
        ),
      )
      .orderBy(asc(organizationRoleGrants.role), asc(organizationRoleGrants.grantId)),
    db
      .select({
        sourceId: organizationDerivedAuthoritySources.sourceId,
        observedAt: organizationDerivedAuthoritySources.observedAt,
        evidenceStatus: organizationDerivedAuthoritySources.status,
        evidenceReviewDeadline: organizationDerivedAuthoritySources.graceUntil,
        evidenceFreshUntil: organizationDerivedAuthoritySources.freshUntil,
      })
      .from(organizationDerivedAuthoritySources)
      .where(
        and(
          eq(organizationDerivedAuthoritySources.deploymentId, 1),
          eq(organizationDerivedAuthoritySources.organizationVersion, organizationVersion),
          eq(organizationDerivedAuthoritySources.userId, userId),
          isNull(organizationDerivedAuthoritySources.invalidatedAt),
        ),
      )
      .orderBy(asc(organizationDerivedAuthoritySources.sourceId)),
    db
      .select({
        assignmentId: organizationGroupAssignments.assignmentId,
        groupId: organizationGroupAssignments.groupId,
        assignedAt: organizationGroupAssignments.assignedAt,
        expiresAt: organizationGroupAssignments.expiresAt,
        bundleId: organizationGroupPermissionBundles.bundleId,
        permissionType: organizationPermissionBundleEntries.permissionType,
        permissionKey: organizationPermissionBundleEntries.permissionKey,
        publisherPackage: organizationPermissionBundleEntries.publisherPackage,
        moduleId: organizationPermissionBundleEntries.moduleId,
        reviewAllowed: organizationPermissionBundleEntries.reviewAllowed,
      })
      .from(organizationGroupAssignments)
      .innerJoin(
        organizationGroups,
        and(
          eq(organizationGroups.groupId, organizationGroupAssignments.groupId),
          eq(organizationGroups.deploymentId, organizationGroupAssignments.deploymentId),
          eq(
            organizationGroups.organizationVersion,
            organizationGroupAssignments.organizationVersion,
          ),
        ),
      )
      .leftJoin(
        organizationGroupPermissionBundles,
        and(
          eq(organizationGroupPermissionBundles.groupId, organizationGroupAssignments.groupId),
          eq(
            organizationGroupPermissionBundles.deploymentId,
            organizationGroupAssignments.deploymentId,
          ),
          eq(
            organizationGroupPermissionBundles.organizationVersion,
            organizationGroupAssignments.organizationVersion,
          ),
        ),
      )
      .leftJoin(
        organizationPermissionBundleEntries,
        and(
          eq(
            organizationPermissionBundleEntries.bundleId,
            organizationGroupPermissionBundles.bundleId,
          ),
          eq(
            organizationPermissionBundleEntries.deploymentId,
            organizationGroupPermissionBundles.deploymentId,
          ),
          eq(
            organizationPermissionBundleEntries.organizationVersion,
            organizationGroupPermissionBundles.organizationVersion,
          ),
        ),
      )
      .where(
        and(
          eq(organizationGroupAssignments.deploymentId, 1),
          eq(organizationGroupAssignments.organizationVersion, organizationVersion),
          eq(organizationGroupAssignments.userId, userId),
          isNull(organizationGroupAssignments.revokedAt),
          or(
            isNull(organizationGroupAssignments.expiresAt),
            gt(organizationGroupAssignments.expiresAt, now),
          ),
        ),
      )
      .orderBy(
        asc(organizationGroupAssignments.assignmentId),
        asc(organizationGroupPermissionBundles.bundleId),
        asc(organizationPermissionBundleEntries.permissionType),
        asc(organizationPermissionBundleEntries.publisherPackage),
        asc(organizationPermissionBundleEntries.moduleId),
        asc(organizationPermissionBundleEntries.permissionKey),
      ),
  ])
  return {
    latestAuditSequence: auditRows[0]?.auditSequence.toString() ?? null,
    roles: [
      ...roleRows.map((role) => ({
        grantId: role.grantId,
        role: role.role,
        grantedAt: role.grantedAt.toISOString(),
        evidenceStatus: role.evidenceStatus,
        evidenceReviewDeadline: role.evidenceReviewDeadline?.toISOString() ?? null,
        evidenceValidUntil: authorityEvidenceValidUntil(role),
      })),
      ...derivedRows.map((source) => ({
        grantId: source.sourceId,
        role: 'derived:director',
        grantedAt: source.observedAt.toISOString(),
        evidenceStatus: source.evidenceStatus,
        evidenceReviewDeadline: source.evidenceReviewDeadline?.toISOString() ?? null,
        evidenceValidUntil: authorityEvidenceValidUntil(source),
      })),
    ],
    groups: groupRows.map((group) => ({
      assignmentId: group.assignmentId,
      groupId: group.groupId,
      assignedAt: group.assignedAt.toISOString(),
      expiresAt: group.expiresAt?.toISOString() ?? null,
      bundleId: group.bundleId,
      permissionType: group.permissionType,
      permissionKey: group.permissionKey,
      publisherPackage: group.publisherPackage,
      moduleId: group.moduleId,
      reviewAllowed: group.reviewAllowed,
    })),
  }
}

function authorityEvidenceValidUntil(evidence: {
  evidenceStatus: string | null
  evidenceFreshUntil: Date | null
  evidenceReviewDeadline: Date | null
}) {
  if (evidence.evidenceStatus === 'fresh') return evidence.evidenceFreshUntil?.toISOString() ?? null
  if (evidence.evidenceStatus === 'degraded')
    return evidence.evidenceReviewDeadline?.toISOString() ?? null
  return null
}
