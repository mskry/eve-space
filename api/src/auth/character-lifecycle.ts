import { and, asc, desc, eq, isNull, lte, or } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '../db/client.js'
import { characters, eveTokens, platformSubjectLifecycles, users } from '../db/schema.js'
import { appendDomainEvent } from '../domain-events/store.js'
import { env } from '../env.js'
import {
  lockCurrentOrganizationVersionForCompliance,
  recomputeOrganizationAccountCompliance,
} from '../organization/compliance.js'
import { enqueueInstalledResourceLifecyclePurges } from '../platform/resource-purge.js'
import { normalizeScopeSet } from '../scopes.js'
import { findCharacterDetachmentBlocker } from '../organization/character-detachment-guards.js'
import { invalidateCharacterAuthoritySourcesInTransaction } from '../organization/authority-convergence.js'
import type { ReviewerUseDisclosure } from '../reviewer-use-disclosure.js'
import { replaceCharacterReviewerDisclosureAcceptances } from './character-disclosure-store.js'
import { lockCharacter, setAuthTransactionLockTimeout } from './character-lock.js'
import { saveCharacterToken } from './character-token-store.js'
import { encryptTokens } from './security.js'
import { hasActiveSession, saveSession, type CharacterSummary } from './session-store.js'

const characterSelection = {
  allianceId: characters.allianceId,
  characterId: characters.characterId,
  corporationId: characters.corporationId,
  isMain: characters.isMain,
  name: characters.name,
}

const ownedCharacterSelection = {
  ...characterSelection,
  subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
}

const authorizationCharacterSelection = {
  userId: characters.userId,
  ownerHash: characters.ownerHash,
  ...characterSelection,
  scopes: eveTokens.scopes,
}

export interface OwnedCharacterSummary extends CharacterSummary {
  subjectLifecycleId: string
}

export class CharacterTransferApprovalRequiredError extends Error {
  constructor() {
    super('Cross-user character attachment requires approval')
  }
}

export async function saveLogin(
  input: CharacterAuthorizationInput & {
    sessionToken: string
    sessionExpiresAt: Date
  },
) {
  const token = prepareToken(input)

  const ownerMismatch = await db.transaction(async (transaction) => {
    await setAuthTransactionLockTimeout(transaction)
    await lockCharacter(transaction, input.characterId)
    const organizationVersion = await lockCurrentOrganizationVersionForCompliance(transaction)

    const [existingCharacter] = await transaction
      .select(authorizationCharacterSelection)
      .from(characters)
      .leftJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
      .where(eq(characters.characterId, input.characterId))

    let userId: string
    if (!existingCharacter) {
      const [user] = await transaction.insert(users).values({}).returning({ id: users.id })
      if (!user) {
        throw new Error('Failed to create user')
      }
      userId = user.id
      await transaction.insert(characters).values(characterValues(input, userId, true))
      await createCharacterSubjectLifecycle(transaction, input.characterId)
    } else {
      userId = existingCharacter.userId
      if (!(await lockUserRow(transaction, userId))) {
        throw new Error('User is missing')
      }
      if (existingCharacter.ownerHash !== input.ownerHash) {
        await invalidateCharacterOwnerMismatch(transaction, existingCharacter, organizationVersion)
        return true
      }
      if (organizationVersion) {
        await recomputeOrganizationAccountCompliance(
          {
            deploymentId: 1,
            now: input.affiliationCheckedAt ?? new Date(),
            organizationVersion,
            userId,
          },
          transaction,
        )
      }
      await updateCharacterIdentity(transaction, input)
    }

    const scopes = normalizeScopeSet(input.scopes)
    const authorizationGeneration = await saveCharacterToken(transaction, {
      characterId: input.characterId,
      scopes,
      ...token,
    })
    if (existingCharacter) {
      await invalidateCharacterAuthoritySourcesInTransaction(transaction, {
        characterId: input.characterId,
        outcome: 'authorization-generation-changed',
      })
    }
    await replaceCharacterReviewerDisclosureAcceptances(transaction, {
      authorizationGeneration,
      characterId: input.characterId,
      disclosures: input.reviewerUseDisclosures ?? [],
    })
    if (existingCharacter) {
      await appendScopeChangeEvent(
        transaction,
        userId,
        input.characterId,
        existingCharacter.scopes ?? [],
        scopes,
      )
    } else {
      await appendDomainEvent(transaction, {
        aggregateId: String(input.characterId),
        payload: { characterId: input.characterId, userId },
        payloadVersion: 1,
        type: 'character.attached',
      })
    }
    await saveSession(transaction, {
      expiresAt: input.sessionExpiresAt,
      sessionToken: input.sessionToken,
      userId,
    })
    if (organizationVersion) {
      await recomputeOrganizationAccountCompliance(
        { deploymentId: 1, organizationVersion, userId },
        transaction,
      )
    }
    return false
  })
  if (ownerMismatch) {
    throw new CharacterOwnershipError()
  }
}

export async function attachCharacter(
  input: CharacterAuthorizationInput & { userId: string; sessionToken?: string },
) {
  const token = prepareToken(input)

  const ownerMismatch = await db.transaction(async (transaction) => {
    await setAuthTransactionLockTimeout(transaction)
    await lockCharacter(transaction, input.characterId)
    const organizationVersion = await lockCurrentOrganizationVersionForCompliance(transaction)
    if (!(await lockUserRow(transaction, input.userId))) {
      throw new CharacterOwnershipError()
    }
    if (
      input.sessionToken &&
      !(await hasActiveSession(transaction, input.sessionToken, input.userId))
    ) {
      throw new CharacterOwnershipError()
    }
    const [existingCharacter] = await transaction
      .select(authorizationCharacterSelection)
      .from(characters)
      .leftJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
      .where(eq(characters.characterId, input.characterId))

    if (existingCharacter && existingCharacter.ownerHash !== input.ownerHash) {
      await invalidateCharacterOwnerMismatch(transaction, existingCharacter, organizationVersion)
      return true
    }
    if (existingCharacter && existingCharacter.userId !== input.userId) {
      throw new CharacterTransferApprovalRequiredError()
    }

    if (organizationVersion) {
      await recomputeOrganizationAccountCompliance(
        {
          deploymentId: 1,
          now: input.affiliationCheckedAt ?? new Date(),
          organizationVersion,
          userId: input.userId,
        },
        transaction,
      )
    }
    if (existingCharacter) {
      await updateCharacterIdentity(transaction, input)
    } else {
      await transaction.insert(characters).values(characterValues(input, input.userId, false))
      await createCharacterSubjectLifecycle(transaction, input.characterId)
    }

    const scopes = normalizeScopeSet(input.scopes)
    const authorizationGeneration = await saveCharacterToken(transaction, {
      characterId: input.characterId,
      scopes,
      ...token,
    })
    await invalidateCharacterAuthoritySourcesInTransaction(transaction, {
      characterId: input.characterId,
      outcome: 'authorization-generation-changed',
    })
    await replaceCharacterReviewerDisclosureAcceptances(transaction, {
      authorizationGeneration,
      characterId: input.characterId,
      disclosures: input.reviewerUseDisclosures ?? [],
    })
    if (existingCharacter) {
      await appendScopeChangeEvent(
        transaction,
        input.userId,
        input.characterId,
        existingCharacter.scopes ?? [],
        scopes,
      )
    } else {
      await appendDomainEvent(transaction, {
        aggregateId: String(input.characterId),
        payload: { characterId: input.characterId, userId: input.userId },
        payloadVersion: 1,
        type: 'character.attached',
      })
    }
    if (organizationVersion) {
      await recomputeOrganizationAccountCompliance(
        { deploymentId: 1, organizationVersion, userId: input.userId },
        transaction,
      )
    }
    return false
  })
  if (ownerMismatch) {
    throw new CharacterTransferApprovalRequiredError()
  }
}

export async function reauthorizeCharacter(
  input: CharacterAuthorizationInput & {
    userId: string
    expectedCharacterId: number
    sessionToken?: string
  },
) {
  if (input.characterId !== input.expectedCharacterId) {
    throw new ReauthorizationCharacterMismatchError()
  }

  const token = prepareToken(input)
  const result = await db.transaction(async (transaction) => {
    await setAuthTransactionLockTimeout(transaction)
    await lockCharacter(transaction, input.characterId)
    const organizationVersion = await lockCurrentOrganizationVersionForCompliance(transaction)
    if (!(await lockUserRow(transaction, input.userId))) {
      throw new CharacterOwnershipError()
    }
    if (
      input.sessionToken &&
      !(await hasActiveSession(transaction, input.sessionToken, input.userId))
    ) {
      throw new CharacterOwnershipError()
    }
    const [ownedCharacter] = await transaction
      .select({
        ...authorizationCharacterSelection,
        subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
      })
      .from(characters)
      .leftJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
      .innerJoin(
        platformSubjectLifecycles,
        eq(platformSubjectLifecycles.characterId, characters.characterId),
      )
      .where(
        and(eq(characters.characterId, input.characterId), eq(characters.userId, input.userId)),
      )

    if (!ownedCharacter) {
      throw new CharacterOwnershipError()
    }
    if (ownedCharacter.ownerHash !== input.ownerHash) {
      await invalidateCharacterOwnerMismatch(transaction, ownedCharacter, organizationVersion)
      return { outcome: 'owner-mismatch' as const }
    }
    if (organizationVersion) {
      await recomputeOrganizationAccountCompliance(
        {
          deploymentId: 1,
          now: input.affiliationCheckedAt ?? new Date(),
          organizationVersion,
          userId: input.userId,
        },
        transaction,
      )
    }
    const affiliationCheckedAt = await updateCharacterIdentity(transaction, input)
    const scopes = normalizeScopeSet(input.scopes)
    const authorizationGeneration = await saveCharacterToken(transaction, {
      characterId: input.characterId,
      scopes,
      ...token,
    })
    await invalidateCharacterAuthoritySourcesInTransaction(transaction, {
      characterId: input.characterId,
      outcome: 'authorization-generation-changed',
    })
    await replaceCharacterReviewerDisclosureAcceptances(transaction, {
      authorizationGeneration,
      characterId: input.characterId,
      disclosures: input.reviewerUseDisclosures ?? [],
    })
    await appendScopeChangeEvent(
      transaction,
      input.userId,
      input.characterId,
      ownedCharacter.scopes ?? [],
      scopes,
    )
    if (organizationVersion) {
      await recomputeOrganizationAccountCompliance(
        { deploymentId: 1, organizationVersion, userId: input.userId },
        transaction,
      )
    }
    return {
      affiliationCheckedAt,
      authorizationGeneration,
      outcome: 'reauthorized' as const,
      subjectLifecycleId: ownedCharacter.subjectLifecycleId,
    }
  })
  if (result.outcome === 'owner-mismatch') {
    throw new CharacterOwnershipError()
  }
  return result
}

export async function listUserCharacters(userId: string): Promise<OwnedCharacterSummary[]> {
  return db
    .select(ownedCharacterSelection)
    .from(characters)
    .innerJoin(
      platformSubjectLifecycles,
      eq(platformSubjectLifecycles.characterId, characters.characterId),
    )
    .where(eq(characters.userId, userId))
    .orderBy(desc(characters.isMain), asc(characters.name), asc(characters.characterId))
}

export async function findOwnedCharacter(
  userId: string,
  characterId: number,
): Promise<OwnedCharacterSummary | null> {
  const [record] = await db
    .select(ownedCharacterSelection)
    .from(characters)
    .innerJoin(
      platformSubjectLifecycles,
      eq(platformSubjectLifecycles.characterId, characters.characterId),
    )
    .where(ownedCharacterFilter(userId, characterId))
  return record ?? null
}

export async function setMainCharacter(
  userId: string,
  characterId: number,
): Promise<CharacterSummary | null> {
  return db.transaction(async (transaction) => {
    await setAuthTransactionLockTimeout(transaction)
    if (!(await lockUserRow(transaction, userId))) {
      return null
    }

    const [target] = await transaction
      .select(characterSelection)
      .from(characters)
      .where(ownedCharacterFilter(userId, characterId))
    if (!target) {
      return null
    }
    if (target.isMain) {
      return target
    }

    const [previousMain] = await transaction
      .select({ characterId: characters.characterId })
      .from(characters)
      .where(and(eq(characters.userId, userId), eq(characters.isMain, true)))

    await transaction.update(characters).set({ isMain: false }).where(eq(characters.userId, userId))
    await transaction
      .update(characters)
      .set({ isMain: true, updatedAt: new Date() })
      .where(ownedCharacterFilter(userId, characterId))
    if (previousMain) {
      await appendDomainEvent(transaction, {
        aggregateId: userId,
        payload: {
          newMainCharacterId: characterId,
          previousMainCharacterId: previousMain.characterId,
          userId,
        },
        payloadVersion: 1,
        type: 'character.main-changed',
      })
    }
    return { ...target, isMain: true }
  })
}

export async function deleteCharacter(
  userId: string,
  characterId: number,
  subjectLifecycleId: string,
) {
  return db.transaction(async (transaction) => {
    await setAuthTransactionLockTimeout(transaction)
    await lockCharacter(transaction, characterId)
    const organizationVersion = await lockCurrentOrganizationVersionForCompliance(transaction)
    if (!(await lockUserRow(transaction, userId))) {
      return 'not-found' as const
    }

    const [target] = await transaction
      .select({
        ...authorizationCharacterSelection,
        subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
      })
      .from(characters)
      .leftJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
      .innerJoin(
        platformSubjectLifecycles,
        eq(platformSubjectLifecycles.characterId, characters.characterId),
      )
      .where(
        and(
          ownedCharacterFilter(userId, characterId),
          eq(platformSubjectLifecycles.subjectLifecycleId, subjectLifecycleId),
        ),
      )
    if (!target) {
      return 'not-found' as const
    }
    if (target.isMain) {
      return 'main-character' as const
    }
    const blocker = await findCharacterDetachmentBlocker(transaction, characterId)
    if (blocker) {
      return blocker
    }

    await enqueueInstalledResourceLifecyclePurges(transaction, subjectLifecycleId)
    await invalidateCharacterAuthoritySourcesInTransaction(transaction, {
      characterId,
      outcome: 'detached',
    })

    const [deleted] = await transaction
      .delete(characters)
      .where(ownedCharacterFilter(userId, characterId))
      .returning({ characterId: characters.characterId })
    if (!deleted) {
      return 'not-found' as const
    }
    await appendDomainEvent(transaction, {
      aggregateId: String(characterId),
      payload: { characterId, userId },
      payloadVersion: 1,
      type: 'character.detached',
    })
    if (organizationVersion) {
      await recomputeOrganizationAccountCompliance(
        { deploymentId: 1, organizationVersion, userId },
        transaction,
      )
    }
    return 'deleted' as const
  })
}

export interface CharacterAuthorizationInput {
  characterId: number
  characterName: string
  ownerHash: string
  corporationId: number
  allianceId: number | null
  affiliationCheckedAt?: Date
  accessToken: string
  refreshToken: string
  expiresIn: number
  scopes: string[]
  reviewerUseDisclosures?: readonly ReviewerUseDisclosure[]
}

class ReauthorizationCharacterMismatchError extends Error {
  constructor() {
    super('Reauthorization returned a different character')
  }
}

class CharacterOwnershipError extends Error {
  constructor() {
    super('Character is not owned by this user')
  }
}

function characterValues(input: CharacterAuthorizationInput, userId: string, isMain: boolean) {
  const affiliationObservedAt = input.affiliationCheckedAt ?? new Date()
  return {
    affiliationCheckedAt: affiliationObservedAt,
    affiliationResolutionState: 'resolved' as const,
    allianceId: input.allianceId,
    characterId: input.characterId,
    corporationId: input.corporationId,
    isMain,
    name: input.characterName,
    nextAffiliationCheck: nextActiveAffiliationCheck(affiliationObservedAt),
    ownerHash: input.ownerHash,
    userId,
  }
}

async function appendScopeChangeEvent(
  transaction: DatabaseTransaction,
  userId: string,
  characterId: number,
  previousScopes: string[],
  nextScopes: string[],
) {
  const previous = new Set(normalizeScopeSet(previousScopes))
  const next = new Set(normalizeScopeSet(nextScopes))
  const addedScopes = [...next].filter((scope) => !previous.has(scope))
  const removedScopes = [...previous].filter((scope) => !next.has(scope))
  if (addedScopes.length === 0 && removedScopes.length === 0) {
    return
  }

  await appendDomainEvent(transaction, {
    aggregateId: String(characterId),
    payload: { addedScopes, characterId, removedScopes, userId },
    payloadVersion: 1,
    type: 'character.scopes-changed',
  })
}

function prepareToken(input: CharacterAuthorizationInput) {
  return {
    accessTokenExpiresAt: new Date(Date.now() + input.expiresIn * 1000),
    encryptedTokens: encryptTokens({
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
    }),
  }
}

async function updateCharacterIdentity(
  transaction: DatabaseTransaction,
  input: CharacterAuthorizationInput,
) {
  const affiliationObservedAt = input.affiliationCheckedAt ?? new Date()
  await transaction
    .update(characters)
    .set({ name: input.characterName, updatedAt: new Date() })
    .where(eq(characters.characterId, input.characterId))
  const [updated] = await transaction
    .update(characters)
    .set({
      affiliationCheckedAt: affiliationObservedAt,
      affiliationResolutionState: 'resolved',
      allianceId: input.allianceId,
      corporationId: input.corporationId,
      nextAffiliationCheck: nextActiveAffiliationCheck(affiliationObservedAt),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(characters.characterId, input.characterId),
        or(
          isNull(characters.affiliationCheckedAt),
          lte(characters.affiliationCheckedAt, affiliationObservedAt),
        ),
      ),
    )
    .returning({ affiliationCheckedAt: characters.affiliationCheckedAt })
  if (updated?.affiliationCheckedAt) {
    return updated.affiliationCheckedAt
  }

  const [current] = await transaction
    .select({ affiliationCheckedAt: characters.affiliationCheckedAt })
    .from(characters)
    .where(eq(characters.characterId, input.characterId))
  if (!current?.affiliationCheckedAt) {
    throw new Error('Character affiliation is missing')
  }
  return current.affiliationCheckedAt
}

async function invalidateCharacterOwnerMismatch(
  transaction: DatabaseTransaction,
  character: { userId: string; characterId: number; scopes: string[] | null },
  organizationVersion: number | null,
) {
  const [lifecycle] = await transaction
    .select({ subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId })
    .from(platformSubjectLifecycles)
    .where(eq(platformSubjectLifecycles.characterId, character.characterId))
  if (lifecycle) {
    await enqueueInstalledResourceLifecyclePurges(transaction, lifecycle.subjectLifecycleId)
  }
  await transaction.delete(eveTokens).where(eq(eveTokens.characterId, character.characterId))
  await invalidateCharacterAuthoritySourcesInTransaction(transaction, {
    characterId: character.characterId,
    outcome: 'owner-mismatch',
  })
  await appendScopeChangeEvent(
    transaction,
    character.userId,
    character.characterId,
    character.scopes ?? [],
    [],
  )
  if (organizationVersion) {
    await recomputeOrganizationAccountCompliance(
      { deploymentId: 1, organizationVersion, userId: character.userId },
      transaction,
    )
  }
}

function nextActiveAffiliationCheck(observedAt: Date) {
  return new Date(observedAt.getTime() + env.AFFILIATION_ACTIVE_INTERVAL_SECONDS * 1000)
}

async function createCharacterSubjectLifecycle(
  transaction: DatabaseTransaction,
  characterId: number,
) {
  const [lifecycle] = await transaction
    .insert(platformSubjectLifecycles)
    .values({
      characterId,
      subjectId: String(characterId),
      subjectKind: 'character',
    })
    .returning({ subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId })
  if (!lifecycle) {
    throw new Error('Failed to create character subject lifecycle')
  }
  return lifecycle.subjectLifecycleId
}

async function lockUserRow(transaction: DatabaseTransaction, userId: string) {
  const [user] = await transaction
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .for('update')
  return Boolean(user)
}

function ownedCharacterFilter(userId: string, characterId: number) {
  return and(eq(characters.userId, userId), eq(characters.characterId, characterId))
}
