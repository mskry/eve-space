import { and, eq, gt } from 'drizzle-orm'
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

export interface SessionAccount {
  userId: string
  mainCharacter: CharacterSummary
}

export async function findSession(sessionToken: string): Promise<SessionAccount | null> {
  const [record] = await db
    .select({
      userId: users.id,
      characterId: characters.characterId,
      name: characters.name,
      corporationId: characters.corporationId,
      allianceId: characters.allianceId,
      isMain: characters.isMain,
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
