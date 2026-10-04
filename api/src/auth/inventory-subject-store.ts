import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  characters,
  eveTokens,
  pendingCharacterTokens,
  platformSubjectLifecycles,
} from '../db/schema.js'

export const loadPersonalInventorySubjects = async (
  userId: string,
  selection: readonly number[] | undefined,
  maximum: number,
) => {
  if (selection?.length === 0) return []
  return db
    .select({
      characterId: characters.characterId,
      characterName: characters.name,
      userId: characters.userId,
      characterLifecycle: platformSubjectLifecycles.subjectLifecycleId,
      authorizationRevision: eveTokens.tokenVersion,
      scopes: eveTokens.scopes,
      pendingAttemptId: pendingCharacterTokens.attemptId,
    })
    .from(characters)
    .innerJoin(
      platformSubjectLifecycles,
      and(
        eq(platformSubjectLifecycles.characterId, characters.characterId),
        eq(platformSubjectLifecycles.subjectKind, 'character'),
      ),
    )
    .leftJoin(eveTokens, eq(eveTokens.characterId, characters.characterId))
    .leftJoin(
      pendingCharacterTokens,
      and(
        eq(pendingCharacterTokens.characterId, characters.characterId),
        eq(pendingCharacterTokens.userId, characters.userId),
        eq(pendingCharacterTokens.subjectLifecycleId, platformSubjectLifecycles.subjectLifecycleId),
        eq(pendingCharacterTokens.baseTokenVersion, eveTokens.tokenVersion),
      ),
    )
    .where(
      and(
        eq(characters.userId, userId),
        selection && inArray(characters.characterId, [...selection]),
      ),
    )
    .orderBy(asc(characters.characterId))
    .limit(maximum + 1)
}
