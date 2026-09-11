import { and, eq, sql } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '../db/client.js'
import { characters, eveTokens, platformSubjectLifecycles } from '../db/schema.js'
import { normalizeScopeSet } from '../scopes.js'
import { lockCharacter, setAuthTransactionLockTimeout } from './character-lock.js'

type TokenReader = Pick<DatabaseTransaction, 'select'>
type TokenWriter = Pick<DatabaseTransaction, 'update'>
type TokenDeleter = Pick<DatabaseTransaction, 'delete'>
const incrementTokenVersion = sql`${eveTokens.tokenVersion} + 1`
const characterCacheAuthorizationSelection = {
  scopes: eveTokens.scopes,
  tokenVersion: eveTokens.tokenVersion,
}

export interface StoredCharacterToken {
  userId: string
  encryptedTokens: string
  accessTokenExpiresAt: Date
  scopes: string[]
  tokenVersion: number
}

export interface StoredCharacterCacheAuthorization {
  scopes: string[]
  tokenVersion: number
}

export class TokenRefreshLockUnavailableError extends Error {
  constructor() {
    super('Token refresh coordination is unavailable')
  }
}

export class CharacterTokenNotFoundError extends Error {
  constructor() {
    super('No EVE token is stored for this character')
  }
}

export async function findCharacterToken(
  characterId: number,
  connection: TokenReader = db,
): Promise<StoredCharacterToken | null> {
  const [record] = await connection
    .select({
      userId: characters.userId,
      encryptedTokens: eveTokens.encryptedTokens,
      accessTokenExpiresAt: eveTokens.accessTokenExpiresAt,
      scopes: eveTokens.scopes,
      tokenVersion: eveTokens.tokenVersion,
    })
    .from(eveTokens)
    .innerJoin(characters, eq(characters.characterId, eveTokens.characterId))
    .where(eq(eveTokens.characterId, characterId))
  return record ?? null
}

export async function findCharacterCacheAuthorization(
  characterId: number,
  connection: TokenReader = db,
): Promise<StoredCharacterCacheAuthorization | null> {
  const [record] = await connection
    .select(characterCacheAuthorizationSelection)
    .from(eveTokens)
    .innerJoin(characters, eq(characters.characterId, eveTokens.characterId))
    .where(eq(eveTokens.characterId, characterId))
  return record ?? null
}

export async function findCharacterTokenForLifecycle(
  characterId: number,
  subjectLifecycleId: string,
  connection: TokenReader = db,
): Promise<StoredCharacterToken | null> {
  const [record] = await connection
    .select({
      userId: characters.userId,
      encryptedTokens: eveTokens.encryptedTokens,
      accessTokenExpiresAt: eveTokens.accessTokenExpiresAt,
      scopes: eveTokens.scopes,
      tokenVersion: eveTokens.tokenVersion,
    })
    .from(eveTokens)
    .innerJoin(characters, eq(characters.characterId, eveTokens.characterId))
    .innerJoin(
      platformSubjectLifecycles,
      eq(platformSubjectLifecycles.characterId, characters.characterId),
    )
    .where(
      and(
        eq(eveTokens.characterId, characterId),
        eq(platformSubjectLifecycles.subjectLifecycleId, subjectLifecycleId),
      ),
    )
  return record ?? null
}

export async function findCharacterCacheAuthorizationForLifecycle(
  characterId: number,
  subjectLifecycleId: string,
  connection: TokenReader = db,
): Promise<StoredCharacterCacheAuthorization | null> {
  const [record] = await connection
    .select(characterCacheAuthorizationSelection)
    .from(eveTokens)
    .innerJoin(characters, eq(characters.characterId, eveTokens.characterId))
    .innerJoin(
      platformSubjectLifecycles,
      eq(platformSubjectLifecycles.characterId, characters.characterId),
    )
    .where(
      and(
        eq(eveTokens.characterId, characterId),
        eq(platformSubjectLifecycles.subjectLifecycleId, subjectLifecycleId),
      ),
    )
  return record ?? null
}

export async function updateCharacterToken(
  input: {
    characterId: number
    encryptedTokens: string
    expiresAt: Date
    scopes: string[]
    tokenVersion: number
  },
  connection: TokenWriter = db,
) {
  const [updated] = await connection
    .update(eveTokens)
    .set({
      encryptedTokens: input.encryptedTokens,
      accessTokenExpiresAt: input.expiresAt,
      scopes: normalizeScopeSet(input.scopes),
      tokenVersion: incrementTokenVersion,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(eveTokens.characterId, input.characterId),
        eq(eveTokens.tokenVersion, input.tokenVersion),
      ),
    )
    .returning({ tokenVersion: eveTokens.tokenVersion })
  return Boolean(updated)
}

export async function deleteCharacterTokenAuthorization(
  characterId: number,
  tokenVersion: number,
  connection: TokenDeleter = db,
) {
  const deleted = await connection
    .delete(eveTokens)
    .where(and(eq(eveTokens.characterId, characterId), eq(eveTokens.tokenVersion, tokenVersion)))
    .returning({ characterId: eveTokens.characterId })
  return deleted.length > 0
}

export async function withCharacterTokenRefreshLock<T>(
  characterId: number,
  operation: (token: StoredCharacterToken, transaction: DatabaseTransaction) => Promise<T>,
) {
  return withCharacterTokenLock(
    characterId,
    (transaction) => findCharacterToken(characterId, transaction),
    operation,
  )
}

export async function withCharacterTokenLifecycleLock<T>(
  characterId: number,
  subjectLifecycleId: string,
  operation: (token: StoredCharacterToken, transaction: DatabaseTransaction) => Promise<T>,
) {
  return withCharacterTokenLock(
    characterId,
    (transaction) => findCharacterTokenForLifecycle(characterId, subjectLifecycleId, transaction),
    operation,
  )
}

export async function saveCharacterToken(
  transaction: DatabaseTransaction,
  input: {
    characterId: number
    scopes: string[]
    encryptedTokens: string
    accessTokenExpiresAt: Date
  },
) {
  await transaction
    .insert(eveTokens)
    .values(input)
    .onConflictDoUpdate({
      target: eveTokens.characterId,
      set: {
        scopes: input.scopes,
        encryptedTokens: input.encryptedTokens,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        tokenVersion: incrementTokenVersion,
        updatedAt: new Date(),
      },
    })
}

export async function insertCharacterToken(
  transaction: DatabaseTransaction,
  input: {
    characterId: number
    scopes: string[]
    encryptedTokens: string
    accessTokenExpiresAt: Date
    tokenVersion: number
  },
) {
  await transaction.insert(eveTokens).values({
    ...input,
    scopes: normalizeScopeSet(input.scopes),
  })
}

async function withCharacterTokenLock<T>(
  characterId: number,
  findToken: (transaction: DatabaseTransaction) => Promise<StoredCharacterToken | null>,
  operation: (token: StoredCharacterToken, transaction: DatabaseTransaction) => Promise<T>,
) {
  try {
    return await db.transaction(async (transaction) => {
      await setAuthTransactionLockTimeout(transaction)
      await lockCharacter(transaction, characterId)
      const token = await findToken(transaction)
      if (!token) throw new CharacterTokenNotFoundError()
      return operation(token, transaction)
    })
  } catch (error) {
    if (hasPostgresErrorCode(error, '55P03')) throw new TokenRefreshLockUnavailableError()
    throw error
  }
}

function hasPostgresErrorCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
