import type {
  OwnedCharacterCoreReads,
  PlatformOwnedCharacterRouteContext,
} from '@eve-space/platform-module-contract/server'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { characters, platformSubjectLifecycles } from '../db/schema.js'

type OwnedCharacterBinding = Pick<
  PlatformOwnedCharacterRouteContext['authorization'],
  'userId' | 'characterId' | 'subjectLifecycleId'
>

export function createOwnedCharacterCoreReads(
  binding: OwnedCharacterBinding,
): OwnedCharacterCoreReads {
  return {
    async loadAffiliation() {
      const [record] = await db
        .select({
          allianceId: characters.allianceId,
          characterId: characters.characterId,
          checkedAt: characters.affiliationCheckedAt,
          corporationId: characters.corporationId,
          resolutionState: characters.affiliationResolutionState,
        })
        .from(characters)
        .innerJoin(
          platformSubjectLifecycles,
          eq(platformSubjectLifecycles.characterId, characters.characterId),
        )
        .where(
          and(
            eq(characters.userId, binding.userId),
            eq(characters.characterId, binding.characterId),
            eq(platformSubjectLifecycles.subjectLifecycleId, binding.subjectLifecycleId),
          ),
        )
        .limit(1)

      if (!record) {
        return null
      }
      return {
        ...record,
        checkedAt: record.checkedAt?.toISOString() ?? null,
      }
    },
  }
}
