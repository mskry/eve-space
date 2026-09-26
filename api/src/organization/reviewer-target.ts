import type {
  PlatformReviewerTargetCompliance,
  PlatformReviewerTargetContext,
} from '@eve-space/platform-module-contract/server'
import { and, asc, desc, eq, gt, isNull, or } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  eveTokens,
  organizationAccountCompliance,
  organizationCharacterExceptions,
  organizationGroupAssignments,
  organizationGroups,
  organizationManagedCorporations,
  organizationManagedMemberLifecycles,
  organizationMemberBlocks,
  platformSubjectLifecycles,
} from '../db/schema.js'
import { resolveAffiliationFreshness } from './affiliation-freshness.js'
import { organizationReviewerPermissionExists } from './reviewer-group-policy.js'
import { hasCurrentReviewerOrganizationSnapshot } from './reviewer-organization-snapshot.js'
const pendingCompliance: PlatformReviewerTargetCompliance = {
  accessValidUntil: null,
  evaluatedAt: null,
  evidenceAt: null,
  evidenceFreshness: 'unavailable',
  reviewDeadline: null,
  state: 'pending',
}

export async function resolveOrganizationReviewerTarget(input: {
  readonly organizationVersion: number
  readonly targetUserId: string
  readonly characterId?: number
  readonly now?: Date
}): Promise<PlatformReviewerTargetContext | null> {
  const now = input.now ?? new Date()
  return db.transaction(
    (transaction) => resolveOrganizationReviewerTargetInTransaction(transaction, input, now),
    { isolationLevel: 'repeatable read' },
  )
}

async function resolveOrganizationReviewerTargetInTransaction(
  transaction: DatabaseTransaction,
  input: {
    readonly organizationVersion: number
    readonly targetUserId: string
    readonly characterId?: number
  },
  now: Date,
): Promise<PlatformReviewerTargetContext | null> {
  if (
    !(await hasCurrentReviewerOrganizationSnapshot(transaction, input.organizationVersion, now))
  ) {
    return null
  }
  const characterRows = await loadTargetCharacters(transaction, input, now)

  const targetCharacters = characterRows.flatMap((character) => {
    const freshness = resolveAffiliationFreshness(character, now)
    let membership: 'managed' | 'approved-external' | null = null
    if (character.managedCorporationId !== null && freshness === 'fresh') {
      membership = 'managed'
    } else if (character.exceptionId !== null) {
      membership = 'approved-external'
    }
    if (!membership) {
      return []
    }
    return [
      {
        affiliation: {
          allianceId: character.allianceId,
          checkedAt: character.affiliationCheckedAt?.toISOString() ?? null,
          corporationId: character.corporationId,
          freshness,
          membership,
        },
        authorizationGeneration: character.authorizationGeneration,
        characterId: character.characterId,
        isMain: character.isMain,
        name: character.name,
        subjectLifecycleId: character.subjectLifecycleId,
      },
    ]
  })
  if (
    !targetCharacters.some(
      ({ affiliation }) =>
        affiliation.membership === 'managed' && affiliation.freshness === 'fresh',
    )
  ) {
    return null
  }

  const selectedCharacter =
    input.characterId === undefined
      ? undefined
      : targetCharacters.find(({ characterId }) => characterId === input.characterId)
  if (input.characterId !== undefined && !selectedCharacter) {
    return null
  }

  const [compliance, groups, block] = await Promise.all([
    loadCompliance(transaction, input.organizationVersion, input.targetUserId),
    loadGroups(transaction, input.organizationVersion, input.targetUserId, now),
    loadBlock(transaction, input.organizationVersion, input.targetUserId),
  ])
  if (!(await isCurrentOrganizationVersion(transaction, input.organizationVersion))) {
    return null
  }

  const mainCharacter = targetCharacters.find(({ isMain }) => isMain)
  return {
    account: {
      mainCharacter: mainCharacter
        ? { characterId: mainCharacter.characterId, name: mainCharacter.name }
        : null,
      userId: input.targetUserId,
    },
    block: block ? { blocked: true, blockedAt: block.blockedAt.toISOString() } : { blocked: false },
    characters: targetCharacters,
    compliance: compliance ?? pendingCompliance,
    groups: groups.map((group) => ({
      groupId: group.groupId,
      assignmentId: group.assignmentId,
      name: group.name,
      restricted: group.restricted,
      managementMode: group.managementMode,
      readOnly:
        group.restricted || group.managementMode !== 'manual' || group.hasReviewerPermission,
      assignedAt: group.assignedAt.toISOString(),
      expiresAt: group.expiresAt?.toISOString() ?? null,
    })),
    managedMemberLifecycleId: characterRows[0]!.managedMemberLifecycleId,
    organizationVersion: input.organizationVersion,
    selection: selectedCharacter
      ? {
          kind: 'character',
          characterId: selectedCharacter.characterId,
          subjectLifecycleId: selectedCharacter.subjectLifecycleId,
        }
      : { kind: 'account' },
  }
}

function loadTargetCharacters(
  transaction: DatabaseTransaction,
  input: {
    readonly organizationVersion: number
    readonly targetUserId: string
  },
  now: Date,
) {
  return transaction
    .select({
      affiliationCheckedAt: characters.affiliationCheckedAt,
      affiliationResolutionState: characters.affiliationResolutionState,
      allianceId: characters.allianceId,
      authorizationGeneration: eveTokens.tokenVersion,
      characterId: characters.characterId,
      corporationId: characters.corporationId,
      exceptionId: organizationCharacterExceptions.exceptionId,
      isMain: characters.isMain,
      managedCorporationId: organizationManagedCorporations.corporationId,
      managedMemberLifecycleId: organizationManagedMemberLifecycles.managedMemberLifecycleId,
      name: characters.name,
      nextAffiliationCheck: characters.nextAffiliationCheck,
      subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
    })
    .from(deploymentSettings)
    .innerJoin(
      characters,
      and(eq(deploymentSettings.id, 1), eq(characters.userId, input.targetUserId)),
    )
    .innerJoin(
      platformSubjectLifecycles,
      eq(platformSubjectLifecycles.characterId, characters.characterId),
    )
    .innerJoin(
      organizationManagedMemberLifecycles,
      and(
        eq(organizationManagedMemberLifecycles.deploymentId, deploymentSettings.id),
        eq(
          organizationManagedMemberLifecycles.organizationVersion,
          deploymentSettings.organizationVersion,
        ),
        eq(organizationManagedMemberLifecycles.userId, characters.userId),
        isNull(organizationManagedMemberLifecycles.endedAt),
      ),
    )
    .leftJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
    .leftJoin(
      organizationManagedCorporations,
      and(
        eq(organizationManagedCorporations.deploymentId, deploymentSettings.id),
        eq(
          organizationManagedCorporations.organizationVersion,
          deploymentSettings.organizationVersion,
        ),
        eq(organizationManagedCorporations.corporationId, characters.corporationId),
        eq(organizationManagedCorporations.isCurrent, true),
      ),
    )
    .leftJoin(
      organizationCharacterExceptions,
      and(
        eq(organizationCharacterExceptions.deploymentId, deploymentSettings.id),
        eq(
          organizationCharacterExceptions.organizationVersion,
          deploymentSettings.organizationVersion,
        ),
        eq(organizationCharacterExceptions.userId, characters.userId),
        eq(organizationCharacterExceptions.characterId, characters.characterId),
        isNull(organizationCharacterExceptions.revokedAt),
        isNull(organizationCharacterExceptions.expiredAt),
        or(
          isNull(organizationCharacterExceptions.expiresAt),
          gt(organizationCharacterExceptions.expiresAt, now),
        ),
      ),
    )
    .where(eq(deploymentSettings.organizationVersion, input.organizationVersion))
    .orderBy(desc(characters.isMain), asc(characters.name), asc(characters.characterId))
}

async function loadCompliance(
  transaction: DatabaseTransaction,
  organizationVersion: number,
  targetUserId: string,
) {
  const [projection] = await transaction
    .select({
      accessValidUntil: organizationAccountCompliance.accessValidUntil,
      evaluatedAt: organizationAccountCompliance.evaluatedAt,
      evidenceAt: organizationAccountCompliance.evidenceAt,
      evidenceFreshness: organizationAccountCompliance.evidenceFreshness,
      reviewDeadline: organizationAccountCompliance.reviewDeadline,
      state: organizationAccountCompliance.state,
    })
    .from(deploymentSettings)
    .innerJoin(
      organizationAccountCompliance,
      and(
        eq(organizationAccountCompliance.deploymentId, deploymentSettings.id),
        eq(
          organizationAccountCompliance.organizationVersion,
          deploymentSettings.organizationVersion,
        ),
        eq(organizationAccountCompliance.userId, targetUserId),
        eq(organizationAccountCompliance.authoritative, true),
      ),
    )
    .where(
      and(
        eq(deploymentSettings.id, 1),
        eq(deploymentSettings.organizationVersion, organizationVersion),
      ),
    )
  if (!projection) {
    return null
  }
  return {
    accessValidUntil: projection.accessValidUntil?.toISOString() ?? null,
    evaluatedAt: projection.evaluatedAt.toISOString(),
    evidenceAt: projection.evidenceAt?.toISOString() ?? null,
    evidenceFreshness: projection.evidenceFreshness,
    reviewDeadline: projection.reviewDeadline?.toISOString() ?? null,
    state: projection.state,
  }
}

function loadGroups(
  transaction: DatabaseTransaction,
  organizationVersion: number,
  targetUserId: string,
  now: Date,
) {
  return transaction
    .select({
      assignedAt: organizationGroupAssignments.assignedAt,
      assignmentId: organizationGroupAssignments.assignmentId,
      expiresAt: organizationGroupAssignments.expiresAt,
      groupId: organizationGroups.groupId,
      hasReviewerPermission: organizationReviewerPermissionExists(
        organizationVersion,
        organizationGroups.groupId,
      ),
      managementMode: organizationGroups.managementMode,
      name: organizationGroups.name,
      restricted: organizationGroups.restricted,
    })
    .from(deploymentSettings)
    .innerJoin(
      organizationGroupAssignments,
      and(
        eq(organizationGroupAssignments.deploymentId, deploymentSettings.id),
        eq(
          organizationGroupAssignments.organizationVersion,
          deploymentSettings.organizationVersion,
        ),
        eq(organizationGroupAssignments.userId, targetUserId),
        isNull(organizationGroupAssignments.revokedAt),
        or(
          isNull(organizationGroupAssignments.expiresAt),
          gt(organizationGroupAssignments.expiresAt, now),
        ),
      ),
    )
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
    .where(
      and(
        eq(deploymentSettings.id, 1),
        eq(deploymentSettings.organizationVersion, organizationVersion),
      ),
    )
    .orderBy(
      asc(organizationGroups.name),
      asc(organizationGroups.groupId),
      asc(organizationGroupAssignments.assignmentId),
    )
}

async function loadBlock(
  transaction: DatabaseTransaction,
  organizationVersion: number,
  targetUserId: string,
) {
  const [block] = await transaction
    .select({ blockedAt: organizationMemberBlocks.blockedAt })
    .from(deploymentSettings)
    .innerJoin(
      organizationMemberBlocks,
      and(
        eq(organizationMemberBlocks.deploymentId, deploymentSettings.id),
        eq(organizationMemberBlocks.organizationVersion, deploymentSettings.organizationVersion),
        eq(organizationMemberBlocks.userId, targetUserId),
        isNull(organizationMemberBlocks.unblockedAt),
      ),
    )
    .where(
      and(
        eq(deploymentSettings.id, 1),
        eq(deploymentSettings.organizationVersion, organizationVersion),
      ),
    )
  return block ?? null
}

async function isCurrentOrganizationVersion(
  transaction: DatabaseTransaction,
  organizationVersion: number,
) {
  const [current] = await transaction
    .select({ organizationVersion: deploymentSettings.organizationVersion })
    .from(deploymentSettings)
    .where(
      and(
        eq(deploymentSettings.id, 1),
        eq(deploymentSettings.organizationVersion, organizationVersion),
      ),
    )
  return current !== undefined
}
