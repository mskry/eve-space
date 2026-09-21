import { and, eq, gt, lt, sql } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '../db/client.js'
import { characters, sessions, users } from '../db/schema.js'
import { hashToken } from './security.js'

export interface CharacterSummary {
  characterId: number
  name: string
  corporationId: number
  allianceId: number | null
  isMain: boolean
}

export type MainCharacterSummary = Omit<CharacterSummary, 'isMain'>

export interface SessionAccount {
  userId: string
  mainCharacter: MainCharacterSummary
}

export interface SessionLifetime {
  idleSeconds: number
  absoluteSeconds: number
  renewalIntervalSeconds: number
}

export async function findSession(sessionToken: string): Promise<SessionAccount | null> {
  const [record] = await db
    .select({
      userId: users.id,
      characterId: characters.characterId,
      name: characters.name,
      corporationId: characters.corporationId,
      allianceId: characters.allianceId,
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
    },
  }
}

export async function renewSession(
  sessionToken: string,
  lifetime: SessionLifetime,
  now = new Date(),
): Promise<Date | null> {
  const idleExpiry = new Date(now.getTime() + lifetime.idleSeconds * 1_000)
  const renewalThreshold = new Date(idleExpiry.getTime() - lifetime.renewalIntervalSeconds * 1_000)
  const renewedExpiry = sql`least(${idleExpiry.toISOString()}::timestamptz, ${sessions.createdAt} + make_interval(secs => ${lifetime.absoluteSeconds}))`
  const [record] = await db
    .update(sessions)
    .set({ expiresAt: renewedExpiry })
    .where(
      and(
        eq(sessions.sessionHash, hashToken(sessionToken)),
        gt(sessions.expiresAt, now),
        lt(sessions.expiresAt, renewalThreshold),
        lt(sessions.expiresAt, renewedExpiry),
      ),
    )
    .returning({ expiresAt: sessions.expiresAt })
  return record?.expiresAt ?? null
}

export async function deleteSession(sessionToken: string) {
  await db.delete(sessions).where(eq(sessions.sessionHash, hashToken(sessionToken)))
}

export async function saveSession(
  transaction: DatabaseTransaction,
  input: { sessionToken: string; userId: string; expiresAt: Date },
) {
  await transaction.insert(sessions).values({
    sessionHash: hashToken(input.sessionToken),
    userId: input.userId,
    expiresAt: input.expiresAt,
  })
}

export async function hasActiveSession(
  transaction: DatabaseTransaction,
  sessionToken: string,
  userId: string,
) {
  const [record] = await transaction
    .select({ sessionHash: sessions.sessionHash })
    .from(sessions)
    .where(
      and(
        eq(sessions.sessionHash, hashToken(sessionToken)),
        eq(sessions.userId, userId),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .for('key share')
  return Boolean(record)
}

export async function deleteUserSessions(transaction: DatabaseTransaction, userId: string) {
  await transaction.delete(sessions).where(eq(sessions.userId, userId))
}
