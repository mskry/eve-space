import { and, count, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
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
import { normalizeScopeSet } from '../scopes.js'
import { lockCharacter, setAuthTransactionLockTimeout } from './character-lock.js'
import { insertCharacterToken } from './character-token-store.js'
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
  if (input.authorization.characterId !== input.characterId)
    throw new CharacterTransferError('approval-unusable')
  const [identity] = await db
    .select({
      characterId: characterTransferApprovals.characterId,
      sourceUserId: characterTransferApprovals.sourceUserId,
      destinationUserId: characterTransferApprovals.destinationUserId,
    })
    .from(characterTransferApprovals)
    .where(eq(characterTransferApprovals.approvalId, input.approvalId))
  if (!identity || !transferIdentityMatches(identity, input))
    throw new CharacterTransferError('approval-unusable')

  return db.transaction(async (transaction) => {
    await setAuthTransactionLockTimeout(transaction)
    await lockCharacter(transaction, input.characterId)
    const organizationVersion = await lockCurrentOrganizationVersionForCompliance(transaction)
    if (!(await lockTransferUsers(transaction, [input.sourceUserId, input.destinationUserId])))
      throw new CharacterTransferError('approval-unusable')

    const [approval] = await transaction
      .select()
      .from(characterTransferApprovals)
      .where(eq(characterTransferApprovals.approvalId, input.approvalId))
      .for('update')
    const now = await loadDatabaseWallClock(transaction)
    if (
      !approval ||
      !transferIdentityMatches(approval, input) ||
      approval.sourceSubjectLifecycleId !== input.sourceSubjectLifecycleId ||
      approval.consumedAt ||
      approval.revokedAt ||
      approval.expiresAt <= now
    )
      throw new CharacterTransferError('approval-unusable')

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
    if (!administrator) throw new CharacterTransferError('approval-unusable')
    if (
      !(await hasActiveSession(transaction, input.destinationSessionToken, input.destinationUserId))
    )
      throw new CharacterTransferError('approval-unusable')

    const [source] = await transaction
      .select({
        userId: characters.userId,
        characterId: characters.characterId,
        name: characters.name,
        corporationId: characters.corporationId,
        allianceId: characters.allianceId,
        isMain: characters.isMain,
        subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
        scopes: eveTokens.scopes,
        tokenVersion: eveTokens.tokenVersion,
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
    if (
      source?.userId !== input.sourceUserId ||
      source.subjectLifecycleId !== input.sourceSubjectLifecycleId ||
      !destinationMain ||
      !sourceRoster?.value
    )
      throw new CharacterTransferError('approval-unusable')
    if (source.isMain && sourceRoster.value > 1) throw new CharacterTransferError('main-character')
    const blocker = await findCharacterDetachmentBlocker(transaction, input.characterId)
    if (blocker) throw new CharacterTransferError(blocker)

    const scopes = normalizeScopeSet(input.authorization.scopes)
    const sourceEvent = await appendDomainEvent(transaction, {
      type: 'character.detached',
      payloadVersion: 1,
      aggregateId: String(input.characterId),
      payload: {
        userId: source.userId,
        characterId: source.characterId,
        characterName: source.name,
        corporationId: source.corporationId,
        allianceId: source.allianceId,
        isMain: source.isMain,
        scopes: normalizeScopeSet(source.scopes ?? []),
      },
      occurredAt: now,
    })
    await transaction.delete(characters).where(eq(characters.characterId, input.characterId))
    const affiliationObservedAt = input.authorization.affiliationCheckedAt ?? now
    await transaction.insert(characters).values({
      characterId: input.characterId,
      userId: input.destinationUserId,
      name: input.authorization.characterName,
      corporationId: input.authorization.corporationId,
      allianceId: input.authorization.allianceId,
      affiliationCheckedAt: affiliationObservedAt,
      affiliationResolutionState: 'resolved',
      nextAffiliationCheck: new Date(
        affiliationObservedAt.getTime() + env.AFFILIATION_ACTIVE_INTERVAL_SECONDS * 1_000,
      ),
      isMain: false,
    })
    const [lifecycle] = await transaction
      .insert(platformSubjectLifecycles)
      .values({
        subjectKind: 'character',
        subjectId: String(input.characterId),
        characterId: input.characterId,
      })
      .returning({ subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId })
    if (!lifecycle) throw new Error('Failed to create transferred character lifecycle')
    await insertCharacterToken(transaction, {
      characterId: input.characterId,
      encryptedTokens: encryptTokens({
        accessToken: input.authorization.accessToken,
        refreshToken: input.authorization.refreshToken,
      }),
      accessTokenExpiresAt: new Date(now.getTime() + input.authorization.expiresIn * 1_000),
      scopes,
      tokenVersion: source.tokenVersion === null ? 0 : source.tokenVersion + 1,
    })
    const destinationEvent = await appendDomainEvent(transaction, {
      type: 'character.attached',
      payloadVersion: 1,
      aggregateId: String(input.characterId),
      payload: {
        userId: input.destinationUserId,
        characterId: input.characterId,
        characterName: input.authorization.characterName,
        corporationId: input.authorization.corporationId,
        allianceId: input.authorization.allianceId,
        isMain: false,
        scopes,
      },
      occurredAt: now,
    })

    if (organizationVersion) {
      await recomputeOrganizationAccountCompliance(
        { deploymentId: 1, organizationVersion, userId: input.sourceUserId, now },
        transaction,
      )
      await recomputeOrganizationAccountCompliance(
        { deploymentId: 1, organizationVersion, userId: input.destinationUserId, now },
        transaction,
      )
    }
    if (sourceRoster.value === 1) {
      await deleteUserSessions(transaction, input.sourceUserId)
      await deleteEmptyTransferSourceUser(transaction, input.sourceUserId)
    }

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
    if (!consumed) throw new CharacterTransferError('approval-unusable')
    await transaction.insert(characterTransferAudit).values({
      approvalId: approval.approvalId,
      action: 'consumed',
      approvedByAdministratorId: approval.approvedByAdministratorId,
      actingDestinationUserId: input.destinationUserId,
      characterId: input.characterId,
      sourceUserId: input.sourceUserId,
      sourceSubjectLifecycleId: input.sourceSubjectLifecycleId,
      destinationUserId: input.destinationUserId,
      newSubjectLifecycleId: lifecycle.subjectLifecycleId,
      sourceEventId: sourceEvent.eventId,
      destinationEventId: destinationEvent.eventId,
      reason: approval.reason,
      outcome: 'consumed',
      occurredAt: now,
    })
    return { subjectLifecycleId: lifecycle.subjectLifecycleId }
  })
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
