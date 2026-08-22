import { and, asc, desc, eq, gt, lte, sql } from 'drizzle-orm'
import { db } from './db/client.js'
import { characters, eveTokens, oauthStates, sessions, users } from './db/schema.js'
import { encryptTokens, hashToken } from './security.js'

export interface CharacterSummary {
  characterId: number
  name: string
  corporationId: number
  allianceId: number | null
  isMain: boolean
}

export interface SessionAccount {
  userId: string
  mainCharacter: CharacterSummary
}

export type OAuthStateContext =
  | { intent: 'login' }
  | { intent: 'attach'; userId: string }
  | { intent: 'reauthorize'; userId: string; characterId: number }

export interface StoredCharacterToken {
  encryptedTokens: string
  accessTokenExpiresAt: Date
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

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type TokenReader = Pick<DatabaseTransaction, 'select'>
type TokenWriter = Pick<DatabaseTransaction, 'update'>
const characterLockNamespace = 1_163_277_105

interface CharacterAuthorizationInput {
  characterId: number
  characterName: string
  corporationId: number
  allianceId: number | null
  accessToken: string
  refreshToken: string
  expiresIn: number
  scopes: string[]
}

export class CharacterOwnershipConflictError extends Error {
  constructor() {
    super('Character belongs to another user')
  }
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

export async function storeOAuthState(state: string, context: OAuthStateContext) {
  await db.delete(oauthStates).where(lte(oauthStates.expiresAt, new Date()))
  await db.insert(oauthStates).values({
    stateHash: hashToken(state),
    intent: context.intent,
    userId: context.intent === 'login' ? null : context.userId,
    characterId: context.intent === 'reauthorize' ? context.characterId : null,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  })
}

export async function consumeOAuthState(state: string): Promise<OAuthStateContext | null> {
  const [record] = await db
    .delete(oauthStates)
    .where(and(eq(oauthStates.stateHash, hashToken(state)), gt(oauthStates.expiresAt, new Date())))
    .returning({
      intent: oauthStates.intent,
      userId: oauthStates.userId,
      characterId: oauthStates.characterId,
    })

  if (!record) return null
  if (record.intent === 'login') return { intent: 'login' }
  if (record.intent === 'attach' && record.userId)
    return { intent: 'attach', userId: record.userId }
  if (record.intent === 'reauthorize' && record.userId && record.characterId)
    return { intent: 'reauthorize', userId: record.userId, characterId: record.characterId }
  throw new Error('Stored OAuth state has invalid authorization context')
}

export async function saveLogin(
  input: CharacterAuthorizationInput & {
    sessionToken: string
    sessionExpiresAt: Date
  },
) {
  const token = prepareToken(input)

  await db.transaction(async (transaction) => {
    await lockCharacterRow(transaction, input.characterId)

    const [existingCharacter] = await transaction
      .select({ userId: characters.userId })
      .from(characters)
      .where(eq(characters.characterId, input.characterId))

    let userId = existingCharacter?.userId
    if (!userId) {
      const [user] = await transaction.insert(users).values({}).returning({ id: users.id })
      if (!user) throw new Error('Failed to create user')
      userId = user.id
      await transaction.insert(characters).values(characterValues(input, userId, true))
    } else {
      await updateCharacterIdentity(transaction, input)
    }

    await upsertCharacterToken(transaction, input.characterId, input.scopes, token)
    await transaction.insert(sessions).values({
      sessionHash: hashToken(input.sessionToken),
      userId,
      expiresAt: input.sessionExpiresAt,
    })
  })
}

export async function attachCharacter(input: CharacterAuthorizationInput & { userId: string }) {
  const token = prepareToken(input)

  await db.transaction(async (transaction) => {
    await lockCharacterRow(transaction, input.characterId)
    const [existingCharacter] = await transaction
      .select({ userId: characters.userId })
      .from(characters)
      .where(eq(characters.characterId, input.characterId))

    if (existingCharacter && existingCharacter.userId !== input.userId)
      throw new CharacterOwnershipConflictError()

    if (existingCharacter) await updateCharacterIdentity(transaction, input)
    else await transaction.insert(characters).values(characterValues(input, input.userId, false))

    await upsertCharacterToken(transaction, input.characterId, input.scopes, token)
  })
}

export async function reauthorizeCharacter(
  input: CharacterAuthorizationInput & { userId: string; expectedCharacterId: number },
) {
  if (input.characterId !== input.expectedCharacterId)
    throw new ReauthorizationCharacterMismatchError()

  const token = prepareToken(input)
  await db.transaction(async (transaction) => {
    await lockCharacterRow(transaction, input.characterId)
    const [ownedCharacter] = await transaction
      .select({ characterId: characters.characterId })
      .from(characters)
      .where(
        and(eq(characters.characterId, input.characterId), eq(characters.userId, input.userId)),
      )

    if (!ownedCharacter) throw new CharacterOwnershipError()
    await updateCharacterIdentity(transaction, input)
    await upsertCharacterToken(transaction, input.characterId, input.scopes, token)
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
): Promise<CharacterSummary | null> {
  const [record] = await db
    .select(characterSelection)
    .from(characters)
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

    await transaction.update(characters).set({ isMain: false }).where(eq(characters.userId, userId))
    await transaction
      .update(characters)
      .set({ isMain: true, updatedAt: new Date() })
      .where(ownedCharacterFilter(userId, characterId))
    return { ...target, isMain: true }
  })
}

export async function deleteCharacter(userId: string, characterId: number) {
  return db.transaction(async (transaction) => {
    if (!(await lockUserRow(transaction, userId))) return 'not-found' as const

    const [target] = await transaction
      .select({ isMain: characters.isMain })
      .from(characters)
      .where(ownedCharacterFilter(userId, characterId))
    if (!target) return 'not-found' as const
    if (target.isMain) return 'main-character' as const

    const [deleted] = await transaction
      .delete(characters)
      .where(ownedCharacterFilter(userId, characterId))
      .returning({ characterId: characters.characterId })
    return deleted ? ('deleted' as const) : ('not-found' as const)
  })
}

export async function findSession(sessionToken: string): Promise<SessionAccount | null> {
  const [record] = await db
    .select({
      userId: users.id,
      ...characterSelection,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(characters, and(eq(characters.userId, users.id), eq(characters.isMain, true)))
    .where(
      and(eq(sessions.sessionHash, hashToken(sessionToken)), gt(sessions.expiresAt, new Date())),
    )

  if (!record) return null
  return {
    userId: record.userId,
    mainCharacter: {
      characterId: record.characterId,
      name: record.name,
      corporationId: record.corporationId,
      allianceId: record.allianceId,
      isMain: record.isMain,
    },
  }
}

export async function deleteSession(sessionToken: string) {
  await db.delete(sessions).where(eq(sessions.sessionHash, hashToken(sessionToken)))
}

export async function findCharacterToken(
  characterId: number,
  connection: TokenReader = db,
): Promise<StoredCharacterToken | null> {
  const [record] = await connection
    .select({
      encryptedTokens: eveTokens.encryptedTokens,
      accessTokenExpiresAt: eveTokens.accessTokenExpiresAt,
      scopes: eveTokens.scopes,
      tokenVersion: eveTokens.tokenVersion,
    })
    .from(eveTokens)
    .where(eq(eveTokens.characterId, characterId))
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
      scopes: input.scopes,
      tokenVersion: sql`${eveTokens.tokenVersion} + 1`,
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

export async function withCharacterTokenRefreshLock<T>(
  characterId: number,
  operation: (token: StoredCharacterToken, transaction: DatabaseTransaction) => Promise<T>,
) {
  try {
    return await db.transaction(async (transaction) => {
      await transaction.execute(sql`set local lock_timeout = '5s'`)
      await lockCharacterRow(transaction, characterId)
      const token = await findCharacterToken(characterId, transaction)
      if (!token) throw new CharacterTokenNotFoundError()
      return operation(token, transaction)
    })
  } catch (error) {
    if (hasPostgresErrorCode(error, '55P03')) throw new TokenRefreshLockUnavailableError()
    throw error
  }
}

const characterSelection = {
  characterId: characters.characterId,
  name: characters.name,
  corporationId: characters.corporationId,
  allianceId: characters.allianceId,
  isMain: characters.isMain,
}

function characterValues(input: CharacterAuthorizationInput, userId: string, isMain: boolean) {
  return {
    characterId: input.characterId,
    userId,
    name: input.characterName,
    corporationId: input.corporationId,
    allianceId: input.allianceId,
    isMain,
  }
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
  await transaction
    .update(characters)
    .set({
      name: input.characterName,
      corporationId: input.corporationId,
      allianceId: input.allianceId,
      updatedAt: new Date(),
    })
    .where(eq(characters.characterId, input.characterId))
}

async function upsertCharacterToken(
  transaction: DatabaseTransaction,
  characterId: number,
  scopes: string[],
  token: { encryptedTokens: string; accessTokenExpiresAt: Date },
) {
  await transaction
    .insert(eveTokens)
    .values({ characterId, scopes, ...token })
    .onConflictDoUpdate({
      target: eveTokens.characterId,
      set: {
        scopes,
        ...token,
        tokenVersion: sql`${eveTokens.tokenVersion} + 1`,
        updatedAt: new Date(),
      },
    })
}

async function lockCharacterRow(transaction: DatabaseTransaction, characterId: number) {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(${characterLockNamespace}, ${characterId})`,
  )
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

function hasPostgresErrorCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
