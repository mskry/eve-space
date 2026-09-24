import { and, count, eq, isNull } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '../db/client.js'
import {
  characterTransferApprovals,
  characterTransferAudit,
  characters,
  deploymentInstallationSettings,
  eveTokens,
  platformSubjectLifecycles,
} from '../db/schema.js'
import { appendDomainEvent } from '../domain-events/store.js'
import { env } from '../env.js'
import {
  lockCurrentOrganizationVersionForCompliance,
  recomputeOrganizationAccountCompliance,
} from '../organization/compliance.js'
import {
  findCharacterDetachmentBlocker,
  type CharacterDetachmentBlocker,
} from '../organization/character-detachment-guards.js'
import { invalidateCharacterAuthoritySourcesInTransaction } from '../organization/authority-convergence.js'
import {
  enqueueInstalledResourceAccountPurges,
  enqueueInstalledResourceLifecyclePurges,
} from '../platform/resource-purge.js'
import { normalizeScopeSet } from '../scopes.js'
import { lockCharacter, setAuthTransactionLockTimeout } from './character-lock.js'
import { insertCharacterToken } from './character-token-store.js'
import { replaceCharacterReviewerDisclosureAcceptances } from './character-disclosure-store.js'
import {
  deleteEmptyTransferSourceUser,
  loadDatabaseWallClock,
  lockTransferUsers,
} from './character-transfer-store.js'
import type { CharacterAuthorizationInput } from './character-lifecycle.js'
import { encryptTokens } from './security.js'
import { deleteUserSessions, hasActiveSession } from './session-store.js'

export type CharacterTransferFailure =
  | 'approval-unusable'
  | 'main-character'
  | CharacterDetachmentBlocker

export class CharacterTransferError extends Error {
  constructor(readonly code: CharacterTransferFailure) {
    super(code)
  }
}

export async function transferCharacter(input: {
  approvalId: string
  sourceUserId: string
  sourceSubjectLifecycleId: string
  destinationUserId: string
  characterId: number
  destinationSessionToken: string
  authorization: CharacterAuthorizationInput
}) {
  if (input.authorization.characterId !== input.characterId) {
    throw new CharacterTransferError('approval-unusable')
  }
  const [identity] = await db
    .select({
      characterId: characterTransferApprovals.characterId,
      destinationUserId: characterTransferApprovals.destinationUserId,
      sourceUserId: characterTransferApprovals.sourceUserId,
    })
    .from(characterTransferApprovals)
    .where(eq(characterTransferApprovals.approvalId, input.approvalId))
  if (!identity || !transferIdentityMatches(identity, input)) {
    throw new CharacterTransferError('approval-unusable')
  }

  return db.transaction(async (transaction) => {
    await setAuthTransactionLockTimeout(transaction)
    await lockCharacter(transaction, input.characterId)
    const organizationVersion = await lockCurrentOrganizationVersionForCompliance(transaction)
    if (!(await lockTransferUsers(transaction, [input.sourceUserId, input.destinationUserId]))) {
      throw new CharacterTransferError('approval-unusable')
    }

    const [approval] = await transaction
      .select()
      .from(characterTransferApprovals)
      .where(eq(characterTransferApprovals.approvalId, input.approvalId))
      .for('update')
    const now = await loadDatabaseWallClock(transaction)
    if (!approval || !usableTransferApproval(approval, input, now)) {
      throw new CharacterTransferError('approval-unusable')
    }

    const [administrator] = await transaction
      .select({ administratorId: deploymentInstallationSettings.ownerAdminId })
      .from(deploymentInstallationSettings)
      .where(
        and(
          eq(deploymentInstallationSettings.id, 1),
          eq(deploymentInstallationSettings.ownerAdminId, approval.approvedByAdministratorId),
        ),
      )
      .for('update')
    if (!administrator) {
      throw new CharacterTransferError('approval-unusable')
    }
    if (
      !(await hasActiveSession(transaction, input.destinationSessionToken, input.destinationUserId))
    ) {
      throw new CharacterTransferError('approval-unusable')
    }

    const [source] = await transaction
      .select({
        characterId: characters.characterId,
        isMain: characters.isMain,
        subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
        tokenVersion: eveTokens.tokenVersion,
        userId: characters.userId,
      })
      .from(characters)
      .innerJoin(
        platformSubjectLifecycles,
        eq(platformSubjectLifecycles.characterId, characters.characterId),
      )
      .leftJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
      .where(eq(characters.characterId, input.characterId))
    const [sourceRoster] = await transaction
      .select({ value: count() })
      .from(characters)
      .where(eq(characters.userId, input.sourceUserId))
    const [destinationMain] = await transaction
      .select({ characterId: characters.characterId })
      .from(characters)
      .where(and(eq(characters.userId, input.destinationUserId), eq(characters.isMain, true)))
    if (!source || !destinationMain || !sourceRoster?.value) {
      throw new CharacterTransferError('approval-unusable')
    }
    if (
      source.userId !== input.sourceUserId ||
      source.subjectLifecycleId !== input.sourceSubjectLifecycleId
    ) {
      throw new CharacterTransferError('approval-unusable')
    }
    if (source.isMain && sourceRoster.value > 1) {
      throw new CharacterTransferError('main-character')
    }
    const blocker = await findCharacterDetachmentBlocker(transaction, input.characterId)
    if (blocker) {
      throw new CharacterTransferError(blocker)
    }
    const affiliationObservedAt = input.authorization.affiliationCheckedAt ?? now
    await recomputeTransferCompliance(
      transaction,
      organizationVersion,
      input,
      affiliationObservedAt,
    )

    const scopes = normalizeScopeSet(input.authorization.scopes)
    const sourceEvent = await appendDomainEvent(transaction, {
      aggregateId: String(input.characterId),
      occurredAt: now,
      payload: {
        characterId: source.characterId,
        userId: source.userId,
      },
      payloadVersion: 1,
      type: 'character.detached',
    })
    await enqueueInstalledResourceLifecyclePurges(transaction, input.sourceSubjectLifecycleId)
    await invalidateCharacterAuthoritySourcesInTransaction(transaction, {
      characterId: input.characterId,
      now,
      outcome: 'transferred',
    })
    await transaction.delete(characters).where(eq(characters.characterId, input.characterId))
    await transaction.insert(characters).values({
      affiliationCheckedAt: affiliationObservedAt,
      affiliationResolutionState: 'resolved',
      allianceId: input.authorization.allianceId,
      characterId: input.characterId,
      corporationId: input.authorization.corporationId,
      isMain: false,
      name: input.authorization.characterName,
      nextAffiliationCheck: new Date(
        affiliationObservedAt.getTime() + env.AFFILIATION_ACTIVE_INTERVAL_SECONDS * 1000,
      ),
      ownerHash: input.authorization.ownerHash,
      userId: input.destinationUserId,
    })
    const [lifecycle] = await transaction
      .insert(platformSubjectLifecycles)
      .values({
        characterId: input.characterId,
        subjectId: String(input.characterId),
        subjectKind: 'character',
      })
      .returning({ subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId })
    if (!lifecycle) {
      throw new Error('Failed to create transferred character lifecycle')
    }
    const authorizationGeneration = await insertCharacterToken(transaction, {
      accessTokenExpiresAt: new Date(now.getTime() + input.authorization.expiresIn * 1000),
      characterId: input.characterId,
      encryptedTokens: encryptTokens({
        accessToken: input.authorization.accessToken,
        refreshToken: input.authorization.refreshToken,
      }),
      scopes,
      tokenVersion: source.tokenVersion === null ? 0 : source.tokenVersion + 1,
    })
    await replaceCharacterReviewerDisclosureAcceptances(transaction, {
      authorizationGeneration,
      characterId: input.characterId,
      disclosures: input.authorization.reviewerUseDisclosures ?? [],
    })
    const destinationEvent = await appendDomainEvent(transaction, {
      aggregateId: String(input.characterId),
      occurredAt: now,
      payload: {
        characterId: input.characterId,
        userId: input.destinationUserId,
      },
      payloadVersion: 1,
      type: 'character.attached',
    })

    await recomputeTransferCompliance(transaction, organizationVersion, input, now)
    await cleanupEmptyTransferSourceAccount(transaction, input.sourceUserId, sourceRoster.value)

    const [consumed] = await transaction
      .update(characterTransferApprovals)
      .set({
        consumedAt: now,
        consumedByUserId: input.destinationUserId,
        newSubjectLifecycleId: lifecycle.subjectLifecycleId,
      })
      .where(
        and(
          eq(characterTransferApprovals.approvalId, approval.approvalId),
          isNull(characterTransferApprovals.consumedAt),
          isNull(characterTransferApprovals.revokedAt),
        ),
      )
      .returning({ approvalId: characterTransferApprovals.approvalId })
    if (!consumed) {
      throw new CharacterTransferError('approval-unusable')
    }
    await transaction.insert(characterTransferAudit).values({
      actingDestinationUserId: input.destinationUserId,
      action: 'consumed',
      approvalId: approval.approvalId,
      approvedByAdministratorId: approval.approvedByAdministratorId,
      characterId: input.characterId,
      destinationEventId: destinationEvent.eventId,
      destinationUserId: input.destinationUserId,
      newSubjectLifecycleId: lifecycle.subjectLifecycleId,
      occurredAt: now,
      outcome: 'consumed',
      reason: approval.reason,
      sourceEventId: sourceEvent.eventId,
      sourceSubjectLifecycleId: input.sourceSubjectLifecycleId,
      sourceUserId: input.sourceUserId,
    })
    return { subjectLifecycleId: lifecycle.subjectLifecycleId }
  })
}

async function recomputeTransferCompliance(
  transaction: DatabaseTransaction,
  organizationVersion: number | null,
  input: Parameters<typeof transferCharacter>[0],
  now: Date,
) {
  if (!organizationVersion) {
    return
  }
  await recomputeOrganizationAccountCompliance(
    { deploymentId: 1, now, organizationVersion, userId: input.sourceUserId },
    transaction,
  )
  await recomputeOrganizationAccountCompliance(
    { deploymentId: 1, now, organizationVersion, userId: input.destinationUserId },
    transaction,
  )
}

function usableTransferApproval(
  approval: typeof characterTransferApprovals.$inferSelect,
  input: Parameters<typeof transferCharacter>[0],
  now: Date,
) {
  return (
    transferIdentityMatches(approval, input) &&
    approval.sourceSubjectLifecycleId === input.sourceSubjectLifecycleId &&
    !approval.consumedAt &&
    !approval.revokedAt &&
    approval.expiresAt > now
  )
}

function transferIdentityMatches(
  identity: { characterId: number; sourceUserId: string; destinationUserId: string },
  input: { characterId: number; sourceUserId: string; destinationUserId: string },
) {
  return (
    identity.characterId === input.characterId &&
    identity.sourceUserId === input.sourceUserId &&
    identity.destinationUserId === input.destinationUserId
  )
}

async function cleanupEmptyTransferSourceAccount(
  transaction: DatabaseTransaction,
  sourceUserId: string,
  sourceCharacterCount: number,
) {
  if (sourceCharacterCount !== 1) {
    return
  }

  await deleteUserSessions(transaction, sourceUserId)
  if (!(await deleteEmptyTransferSourceUser(transaction, sourceUserId))) {
    return
  }

  await enqueueInstalledResourceAccountPurges(transaction, sourceUserId)
}
