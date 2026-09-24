import { and, asc, count, eq, gt, sql } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '../db/client.js'
import {
  characterTransferApprovals,
  characterTransferAudit,
  characterTransferPreviews,
  characters,
  deploymentInstallationSettings,
  platformSubjectLifecycles,
} from '../db/schema.js'
import { lockCurrentOrganizationVersionForCompliance } from '../organization/compliance.js'
import {
  findCharacterDetachmentBlocker,
  type CharacterDetachmentBlocker,
} from '../organization/character-detachment-guards.js'
import { lockCharacter, setAuthTransactionLockTimeout } from './character-lock.js'
import { createOpaqueToken, hashToken, tokensMatch } from './security.js'
import { loadDatabaseWallClock, lockTransferUsers } from './character-transfer-store.js'

const previewTtlMs = 5 * 60 * 1000
const approvalTtlMs = 15 * 60 * 1000

export type CharacterTransferBlocker =
  | 'unavailable'
  | 'same-account'
  | 'destination-main'
  | 'main-character'
  | CharacterDetachmentBlocker

export class CharacterTransferApprovalError extends Error {
  constructor(
    readonly code:
      | 'preview-unavailable'
      | 'preview-stale'
      | 'approval-unavailable'
      | 'approval-expired'
      | 'approval-revoked'
      | 'approval-consumed',
  ) {
    super(code)
  }
}

export async function previewCharacterTransfer(input: {
  administratorId: string
  characterId: number
  destinationMainCharacterId: number
  reason: string
}) {
  return db.transaction(async (transaction) => {
    await setAuthTransactionLockTimeout(transaction)
    const initial = await loadTransferCandidates(transaction, input)
    if (!initial) {
      return { blocker: 'unavailable' as const, eligible: false as const }
    }

    await lockCharacter(transaction, input.characterId)
    await lockCurrentOrganizationVersionForCompliance(transaction)
    if (
      !(await lockTransferUsers(transaction, [initial.sourceUserId, initial.destinationUserId]))
    ) {
      return { blocker: 'unavailable' as const, eligible: false as const }
    }
    const candidates = await loadTransferCandidates(transaction, input)
    if (!candidates) {
      return { blocker: 'unavailable' as const, eligible: false as const }
    }

    const blocker = await findTransferBlocker(transaction, candidates)
    const publicPreview = toPublicPreview(candidates)
    if (blocker) {
      return { blocker, eligible: false as const, ...publicPreview }
    }

    const now = await loadDatabaseWallClock(transaction)
    const [preview] = await transaction
      .insert(characterTransferPreviews)
      .values({
        administratorId: input.administratorId,
        characterId: candidates.characterId,
        characterName: candidates.characterName,
        createdAt: now,
        destinationMainCharacterId: candidates.destinationMainCharacterId,
        destinationMainCharacterName: candidates.destinationMainCharacterName,
        destinationUserId: candidates.destinationUserId,
        expiresAt: new Date(now.getTime() + previewTtlMs),
        reason: input.reason,
        sourceCharacterCount: candidates.sourceCharacterCount,
        sourceSubjectLifecycleId: candidates.sourceSubjectLifecycleId,
        sourceUserId: candidates.sourceUserId,
      })
      .returning({
        expiresAt: characterTransferPreviews.expiresAt,
        previewId: characterTransferPreviews.previewId,
      })
    if (!preview) {
      throw new Error('Failed to store character transfer preview')
    }
    return { eligible: true as const, ...publicPreview, ...preview }
  })
}

export async function createCharacterTransferApproval(input: {
  administratorId: string
  previewId: string
}) {
  return db.transaction(async (transaction) => {
    await setAuthTransactionLockTimeout(transaction)
    const initial = await findPreview(transaction, input)
    if (!initial) {
      throw new CharacterTransferApprovalError('preview-unavailable')
    }

    await lockCharacter(transaction, initial.characterId)
    await lockCurrentOrganizationVersionForCompliance(transaction)
    if (
      !(await lockTransferUsers(transaction, [initial.sourceUserId, initial.destinationUserId]))
    ) {
      throw new CharacterTransferApprovalError('preview-stale')
    }
    const preview = await findPreview(transaction, input, true)
    if (!preview) {
      throw new CharacterTransferApprovalError('preview-stale')
    }
    const candidates = await loadTransferCandidates(transaction, {
      characterId: preview.characterId,
      destinationMainCharacterId: preview.destinationMainCharacterId,
    })
    if (!candidates || !previewMatches(preview, candidates)) {
      throw new CharacterTransferApprovalError('preview-stale')
    }
    if (await findTransferBlocker(transaction, candidates)) {
      throw new CharacterTransferApprovalError('preview-stale')
    }

    const now = await loadDatabaseWallClock(transaction)
    const secret = createOpaqueToken()
    const [approval] = await transaction
      .insert(characterTransferApprovals)
      .values({
        approvedByAdministratorId: input.administratorId,
        characterId: preview.characterId,
        characterName: preview.characterName,
        createdAt: now,
        destinationMainCharacterId: preview.destinationMainCharacterId,
        destinationMainCharacterName: preview.destinationMainCharacterName,
        destinationUserId: preview.destinationUserId,
        expiresAt: new Date(now.getTime() + approvalTtlMs),
        linkSecretHash: hashToken(secret),
        reason: preview.reason,
        sourceCharacterCount: preview.sourceCharacterCount,
        sourceSubjectLifecycleId: preview.sourceSubjectLifecycleId,
        sourceUserId: preview.sourceUserId,
      })
      .returning()
    if (!approval) {
      throw new Error('Failed to create character transfer approval')
    }
    await transaction.insert(characterTransferAudit).values({
      action: 'created',
      actionAdministratorId: input.administratorId,
      approvalId: approval.approvalId,
      approvedByAdministratorId: input.administratorId,
      characterId: approval.characterId,
      destinationUserId: approval.destinationUserId,
      occurredAt: now,
      outcome: 'created',
      reason: approval.reason,
      sourceSubjectLifecycleId: approval.sourceSubjectLifecycleId,
      sourceUserId: approval.sourceUserId,
    })
    await transaction
      .delete(characterTransferPreviews)
      .where(eq(characterTransferPreviews.previewId, preview.previewId))

    return { approval: toApprovalDto(approval, now), secret }
  })
}

export async function inspectCharacterTransferApproval(approvalId: string) {
  const [approval] = await db
    .select()
    .from(characterTransferApprovals)
    .where(eq(characterTransferApprovals.approvalId, approvalId))
  if (!approval) {
    return null
  }
  const audit = await db
    .select({
      action: characterTransferAudit.action,
      occurredAt: characterTransferAudit.occurredAt,
      outcome: characterTransferAudit.outcome,
      reason: characterTransferAudit.reason,
    })
    .from(characterTransferAudit)
    .where(eq(characterTransferAudit.approvalId, approvalId))
    .orderBy(asc(characterTransferAudit.occurredAt), asc(characterTransferAudit.auditId))
  return { approval: toApprovalDto(approval, new Date()), audit }
}

export async function revokeCharacterTransferApproval(input: {
  administratorId: string
  approvalId: string
  reason: string
}) {
  return db.transaction(async (transaction) => {
    await setAuthTransactionLockTimeout(transaction)
    const [approval] = await transaction
      .select()
      .from(characterTransferApprovals)
      .where(eq(characterTransferApprovals.approvalId, input.approvalId))
      .for('update')
    if (!approval) {
      throw new CharacterTransferApprovalError('approval-unavailable')
    }
    if (approval.consumedAt) {
      throw new CharacterTransferApprovalError('approval-consumed')
    }
    if (approval.revokedAt) {
      throw new CharacterTransferApprovalError('approval-revoked')
    }
    const now = await loadDatabaseWallClock(transaction)
    if (approval.expiresAt <= now) {
      throw new CharacterTransferApprovalError('approval-expired')
    }

    const [revoked] = await transaction
      .update(characterTransferApprovals)
      .set({
        revocationReason: input.reason,
        revokedAt: now,
        revokedByAdministratorId: input.administratorId,
      })
      .where(eq(characterTransferApprovals.approvalId, input.approvalId))
      .returning()
    if (!revoked) {
      throw new Error('Failed to revoke character transfer approval')
    }
    await transaction.insert(characterTransferAudit).values({
      action: 'revoked',
      actionAdministratorId: input.administratorId,
      approvalId: approval.approvalId,
      approvedByAdministratorId: approval.approvedByAdministratorId,
      characterId: approval.characterId,
      destinationUserId: approval.destinationUserId,
      occurredAt: now,
      outcome: 'revoked',
      reason: input.reason,
      sourceSubjectLifecycleId: approval.sourceSubjectLifecycleId,
      sourceUserId: approval.sourceUserId,
    })
    return toApprovalDto(revoked, now)
  })
}

export async function loadTransferApprovalForStart(input: {
  approvalId: string
  secret: string
  destinationUserId: string
}) {
  return db.transaction(async (transaction) => {
    const [approval] = await transaction
      .select()
      .from(characterTransferApprovals)
      .where(eq(characterTransferApprovals.approvalId, input.approvalId))
    if (
      approval?.destinationUserId !== input.destinationUserId ||
      approval.consumedAt ||
      approval.revokedAt ||
      !tokensMatch(hashToken(input.secret), approval.linkSecretHash)
    ) {
      return null
    }
    const now = await loadDatabaseWallClock(transaction)
    if (approval.expiresAt <= now) {
      return null
    }

    const [source] = await transaction
      .select({
        subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
        userId: characters.userId,
      })
      .from(characters)
      .innerJoin(
        platformSubjectLifecycles,
        eq(platformSubjectLifecycles.characterId, characters.characterId),
      )
      .where(eq(characters.characterId, approval.characterId))
    const [destinationMain] = await transaction
      .select({ characterId: characters.characterId })
      .from(characters)
      .where(and(eq(characters.userId, approval.destinationUserId), eq(characters.isMain, true)))
    const [administrator] = await transaction
      .select({ administratorId: deploymentInstallationSettings.ownerAdminId })
      .from(deploymentInstallationSettings)
      .where(eq(deploymentInstallationSettings.id, 1))
    if (
      source?.userId !== approval.sourceUserId ||
      source?.subjectLifecycleId !== approval.sourceSubjectLifecycleId ||
      !destinationMain ||
      administrator?.administratorId !== approval.approvedByAdministratorId
    ) {
      return null
    }
    return {
      approvalId: approval.approvalId,
      characterId: approval.characterId,
      sourceSubjectLifecycleId: approval.sourceSubjectLifecycleId,
      sourceUserId: approval.sourceUserId,
      userId: approval.destinationUserId,
    }
  })
}

async function loadTransferCandidates(
  transaction: DatabaseTransaction,
  input: { characterId: number; destinationMainCharacterId: number },
) {
  const [source] = await transaction
    .select({
      characterId: characters.characterId,
      characterName: characters.name,
      sourceIsMain: characters.isMain,
      sourceSubjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
      sourceUserId: characters.userId,
    })
    .from(characters)
    .innerJoin(
      platformSubjectLifecycles,
      eq(platformSubjectLifecycles.characterId, characters.characterId),
    )
    .where(eq(characters.characterId, input.characterId))
  const [destination] = await transaction
    .select({
      destinationIsMain: characters.isMain,
      destinationMainCharacterId: characters.characterId,
      destinationMainCharacterName: characters.name,
      destinationUserId: characters.userId,
    })
    .from(characters)
    .where(eq(characters.characterId, input.destinationMainCharacterId))
  if (!source || !destination) {
    return null
  }
  const [sourceCount] = await transaction
    .select({ value: count() })
    .from(characters)
    .where(eq(characters.userId, source.sourceUserId))
  return {
    ...source,
    ...destination,
    sourceCharacterCount: sourceCount?.value ?? 0,
  }
}

async function findTransferBlocker(
  transaction: DatabaseTransaction,
  candidates: NonNullable<Awaited<ReturnType<typeof loadTransferCandidates>>>,
): Promise<CharacterTransferBlocker | null> {
  if (candidates.sourceUserId === candidates.destinationUserId) {
    return 'same-account'
  }
  if (!candidates.destinationIsMain) {
    return 'destination-main'
  }
  if (candidates.sourceIsMain && candidates.sourceCharacterCount > 1) {
    return 'main-character'
  }
  return findCharacterDetachmentBlocker(transaction, candidates.characterId)
}

async function findPreview(
  transaction: DatabaseTransaction,
  input: { administratorId: string; previewId: string },
  lock = false,
) {
  const query = transaction
    .select()
    .from(characterTransferPreviews)
    .where(
      and(
        eq(characterTransferPreviews.previewId, input.previewId),
        eq(characterTransferPreviews.administratorId, input.administratorId),
        gt(characterTransferPreviews.expiresAt, sql`clock_timestamp()`),
      ),
    )
  const records = lock ? await query.for('update') : await query
  return records[0] ?? null
}

function previewMatches(
  preview: typeof characterTransferPreviews.$inferSelect,
  candidates: NonNullable<Awaited<ReturnType<typeof loadTransferCandidates>>>,
) {
  return (
    preview.sourceUserId === candidates.sourceUserId &&
    preview.sourceSubjectLifecycleId === candidates.sourceSubjectLifecycleId &&
    preview.sourceCharacterCount === candidates.sourceCharacterCount &&
    preview.destinationUserId === candidates.destinationUserId &&
    preview.destinationMainCharacterId === candidates.destinationMainCharacterId &&
    candidates.destinationIsMain
  )
}

function toPublicPreview(
  candidates: NonNullable<Awaited<ReturnType<typeof loadTransferCandidates>>>,
) {
  return {
    character: { characterId: candidates.characterId, name: candidates.characterName },
    destinationMain: {
      characterId: candidates.destinationMainCharacterId,
      name: candidates.destinationMainCharacterName,
    },
    sourceCharacterCount: candidates.sourceCharacterCount,
  }
}

function toApprovalDto(approval: typeof characterTransferApprovals.$inferSelect, now: Date) {
  const status = transferApprovalStatus(approval, now)
  return {
    approvalId: approval.approvalId,
    character: { characterId: approval.characterId, name: approval.characterName },
    consumedAt: approval.consumedAt,
    createdAt: approval.createdAt,
    destinationMain: {
      characterId: approval.destinationMainCharacterId,
      name: approval.destinationMainCharacterName,
    },
    expiresAt: approval.expiresAt,
    reason: approval.reason,
    revocationReason: approval.revocationReason,
    revokedAt: approval.revokedAt,
    sourceCharacterCount: approval.sourceCharacterCount,
    status,
  }
}

function transferApprovalStatus(
  approval: typeof characterTransferApprovals.$inferSelect,
  now: Date,
) {
  if (approval.consumedAt) {
    return 'consumed' as const
  }
  if (approval.revokedAt) {
    return 'revoked' as const
  }
  return approval.expiresAt <= now ? ('expired' as const) : ('pending' as const)
}
