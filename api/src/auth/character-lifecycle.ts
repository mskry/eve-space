import { and, asc, desc, eq, isNull, lte, or } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '../db/client.js'
import {
  characters,
  deploymentSettings,
  eveTokens,
  organizationAuthorityEvidence,
  organizationCorporationSources,
  organizationManagedCorporations,
  organizationRoleGrants,
  platformSubjectLifecycles,
  users,
} from '../db/schema.js'
import { appendDomainEvent } from '../domain-events/store.js'
import { env } from '../env.js'
import {
  lockCurrentOrganizationVersionForCompliance,
  recomputeOrganizationAccountCompliance,
} from '../organization/compliance.js'
import { normalizeScopeSet } from '../scopes.js'
import { lockCharacter } from './character-lock.js'
import { saveCharacterToken } from './character-token-store.js'
import { encryptTokens } from './security.js'
import { saveSession, type CharacterSummary } from './session-store.js'

const characterSelection = {
  characterId: characters.characterId,
  name: characters.name,
  corporationId: characters.corporationId,
  allianceId: characters.allianceId,
  isMain: characters.isMain,
}

const ownedCharacterSelection = {
  ...characterSelection,
  subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId,
}

const authorizationCharacterSelection = {
  userId: characters.userId,
  ...characterSelection,
  scopes: eveTokens.scopes,
}

export interface OwnedCharacterSummary extends CharacterSummary {
  subjectLifecycleId: string
}

export class CharacterOwnershipConflictError extends Error {
  constructor() {
    super('Character belongs to another user')
  }
}

export async function saveLogin(
  input: CharacterAuthorizationInput & {
    sessionToken: string
    sessionExpiresAt: Date
  },
) {
  const token = prepareToken(input)

  await db.transaction(async (transaction) => {
    await lockCharacter(transaction, input.characterId)
    const organizationVersion = await lockCurrentOrganizationVersionForCompliance(transaction)

    const [existingCharacter] = await transaction
      .select(authorizationCharacterSelection)
      .from(characters)
      .leftJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
      .where(eq(characters.characterId, input.characterId))

    let userId = existingCharacter?.userId
    if (!userId) {
      const [user] = await transaction.insert(users).values({}).returning({ id: users.id })
      if (!user) throw new Error('Failed to create user')
      userId = user.id
      await transaction.insert(characters).values(characterValues(input, userId, true))
      await createCharacterSubjectLifecycle(transaction, input.characterId)
    } else {
      if (!(await lockUserRow(transaction, userId))) throw new Error('User is missing')
      await updateCharacterIdentity(transaction, input)
    }

    const scopes = normalizeScopeSet(input.scopes)
    await saveCharacterToken(transaction, { characterId: input.characterId, scopes, ...token })
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
        type: 'character.attached',
        payloadVersion: 1,
        aggregateId: String(input.characterId),
        payload: characterSnapshotFromInput(input, userId, true, scopes),
      })
    }
    await saveSession(transaction, {
      sessionToken: input.sessionToken,
      userId,
      expiresAt: input.sessionExpiresAt,
    })
    if (organizationVersion)
      await recomputeOrganizationAccountCompliance(
        { deploymentId: 1, organizationVersion, userId },
        transaction,
      )
  })
}

export async function attachCharacter(input: CharacterAuthorizationInput & { userId: string }) {
  const token = prepareToken(input)

  await db.transaction(async (transaction) => {
    await lockCharacter(transaction, input.characterId)
    const organizationVersion = await lockCurrentOrganizationVersionForCompliance(transaction)
    if (!(await lockUserRow(transaction, input.userId))) throw new CharacterOwnershipError()
    const [existingCharacter] = await transaction
      .select(authorizationCharacterSelection)
      .from(characters)
      .leftJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
      .where(eq(characters.characterId, input.characterId))

    if (existingCharacter && existingCharacter.userId !== input.userId)
      throw new CharacterOwnershipConflictError()

    if (existingCharacter) await updateCharacterIdentity(transaction, input)
    else {
      await transaction.insert(characters).values(characterValues(input, input.userId, false))
      await createCharacterSubjectLifecycle(transaction, input.characterId)
    }

    const scopes = normalizeScopeSet(input.scopes)
    await saveCharacterToken(transaction, { characterId: input.characterId, scopes, ...token })
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
        type: 'character.attached',
        payloadVersion: 1,
        aggregateId: String(input.characterId),
        payload: characterSnapshotFromInput(input, input.userId, false, scopes),
      })
    }
    if (organizationVersion)
      await recomputeOrganizationAccountCompliance(
        { deploymentId: 1, organizationVersion, userId: input.userId },
        transaction,
      )
  })
}

export async function reauthorizeCharacter(
  input: CharacterAuthorizationInput & { userId: string; expectedCharacterId: number },
) {
  if (input.characterId !== input.expectedCharacterId)
    throw new ReauthorizationCharacterMismatchError()

  const token = prepareToken(input)
  return db.transaction(async (transaction) => {
    await lockCharacter(transaction, input.characterId)
    const organizationVersion = await lockCurrentOrganizationVersionForCompliance(transaction)
    if (!(await lockUserRow(transaction, input.userId))) throw new CharacterOwnershipError()
    const [ownedCharacter] = await transaction
      .select(authorizationCharacterSelection)
      .from(characters)
      .leftJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
      .where(
        and(eq(characters.characterId, input.characterId), eq(characters.userId, input.userId)),
      )

    if (!ownedCharacter) throw new CharacterOwnershipError()
    const affiliationCheckedAt = await updateCharacterIdentity(transaction, input)
    const scopes = normalizeScopeSet(input.scopes)
    await saveCharacterToken(transaction, { characterId: input.characterId, scopes, ...token })
    await appendScopeChangeEvent(
      transaction,
      input.userId,
      input.characterId,
      ownedCharacter.scopes ?? [],
      scopes,
    )
    if (organizationVersion)
      await recomputeOrganizationAccountCompliance(
        { deploymentId: 1, organizationVersion, userId: input.userId },
        transaction,
      )
    return affiliationCheckedAt
  })
}

export async function listUserCharacters(userId: string): Promise<CharacterSummary[]> {
  return db
    .select(characterSelection)
    .from(characters)
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
    if (!(await lockUserRow(transaction, userId))) return null

    const [target] = await transaction
      .select(characterSelection)
      .from(characters)
      .where(ownedCharacterFilter(userId, characterId))
    if (!target) return null
    if (target.isMain) return target

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
        type: 'character.main-changed',
        payloadVersion: 1,
        aggregateId: userId,
        payload: {
          userId,
          previousMainCharacterId: previousMain.characterId,
          newMainCharacterId: characterId,
        },
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
    await lockCharacter(transaction, characterId)
    const organizationVersion = await lockCurrentOrganizationVersionForCompliance(transaction)
    if (!(await lockUserRow(transaction, userId))) return 'not-found' as const

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
    if (!target) return 'not-found' as const
    if (target.isMain) return 'main-character' as const
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
    if (retainedAuthorityEvidence) return 'authority-evidence' as const
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
    if (activeCorporationSource) return 'corporation-source' as const

    const [deleted] = await transaction
      .delete(characters)
      .where(ownedCharacterFilter(userId, characterId))
      .returning({ characterId: characters.characterId })
    if (!deleted) return 'not-found' as const
    await appendDomainEvent(transaction, {
      type: 'character.detached',
      payloadVersion: 1,
      aggregateId: String(characterId),
      payload: characterSnapshotFromRecord(target),
    })
    if (organizationVersion)
      await recomputeOrganizationAccountCompliance(
        { deploymentId: 1, organizationVersion, userId },
        transaction,
      )
    return 'deleted' as const
  })
}

interface CharacterAuthorizationInput {
  characterId: number
  characterName: string
  corporationId: number
  allianceId: number | null
  affiliationCheckedAt?: Date
  accessToken: string
  refreshToken: string
  expiresIn: number
  scopes: string[]
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
    characterId: input.characterId,
    userId,
    name: input.characterName,
    corporationId: input.corporationId,
    allianceId: input.allianceId,
    affiliationCheckedAt: affiliationObservedAt,
    affiliationResolutionState: 'resolved' as const,
    nextAffiliationCheck: nextActiveAffiliationCheck(affiliationObservedAt),
    isMain,
  }
}

function characterSnapshotFromInput(
  input: CharacterAuthorizationInput,
  userId: string,
  isMain: boolean,
  scopes: string[],
) {
  return {
    userId,
    characterId: input.characterId,
    characterName: input.characterName,
    corporationId: input.corporationId,
    allianceId: input.allianceId,
    isMain,
    scopes,
  }
}

function characterSnapshotFromRecord(record: {
  userId: string
  characterId: number
  name: string
  corporationId: number
  allianceId: number | null
  isMain: boolean
  scopes: string[] | null
}) {
  return {
    userId: record.userId,
    characterId: record.characterId,
    characterName: record.name,
    corporationId: record.corporationId,
    allianceId: record.allianceId,
    isMain: record.isMain,
    scopes: normalizeScopeSet(record.scopes ?? []),
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
  if (addedScopes.length === 0 && removedScopes.length === 0) return

  await appendDomainEvent(transaction, {
    type: 'character.scopes-changed',
    payloadVersion: 1,
    aggregateId: String(characterId),
    payload: { userId, characterId, addedScopes, removedScopes },
  })
}

function prepareToken(input: CharacterAuthorizationInput) {
  return {
    encryptedTokens: encryptTokens({
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
    }),
    accessTokenExpiresAt: new Date(Date.now() + input.expiresIn * 1000),
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
      corporationId: input.corporationId,
      allianceId: input.allianceId,
      affiliationCheckedAt: affiliationObservedAt,
      affiliationResolutionState: 'resolved',
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
  if (updated?.affiliationCheckedAt) return updated.affiliationCheckedAt

  const [current] = await transaction
    .select({ affiliationCheckedAt: characters.affiliationCheckedAt })
    .from(characters)
    .where(eq(characters.characterId, input.characterId))
  if (!current?.affiliationCheckedAt) throw new Error('Character affiliation is missing')
  return current.affiliationCheckedAt
}

function nextActiveAffiliationCheck(observedAt: Date) {
  return new Date(observedAt.getTime() + env.AFFILIATION_ACTIVE_INTERVAL_SECONDS * 1_000)
}

async function createCharacterSubjectLifecycle(
  transaction: DatabaseTransaction,
  characterId: number,
) {
  const [lifecycle] = await transaction
    .insert(platformSubjectLifecycles)
    .values({
      subjectKind: 'character',
      subjectId: String(characterId),
      characterId,
    })
    .returning({ subjectLifecycleId: platformSubjectLifecycles.subjectLifecycleId })
  if (!lifecycle) throw new Error('Failed to create character subject lifecycle')
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
