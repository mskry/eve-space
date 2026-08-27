import type {
  OwnedCharacterCoreReads,
  PlatformOwnedCharacterRouteContext,
  SdeCoreReads,
} from '@eve-space/platform-module-contract'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { characters, platformSubjectLifecycles, sdeGroups, sdeTypes } from '../db/schema.js'

const maxCoreSdeTypeIds = 500

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
          characterId: characters.characterId,
          corporationId: characters.corporationId,
          allianceId: characters.allianceId,
          checkedAt: characters.affiliationCheckedAt,
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

      if (!record) return null
      return {
        ...record,
        checkedAt: record.checkedAt?.toISOString() ?? null,
      }
    },
  }
}

export const sdeCoreReads = {
  async loadPublishedTypeGroups(typeIds: readonly number[]) {
    if (typeIds.length > maxCoreSdeTypeIds)
      throw new Error(`SDE type lookup cannot exceed ${maxCoreSdeTypeIds} IDs`)
    if (typeIds.some((typeId) => !Number.isSafeInteger(typeId) || typeId <= 0))
      throw new Error('SDE type lookup IDs must be positive safe integers')

    const uniqueTypeIds = [...new Set(typeIds)]
    if (uniqueTypeIds.length === 0) return []

    return db
      .select({
        typeId: sdeTypes.typeId,
        typeName: sdeTypes.name,
        groupId: sdeGroups.groupId,
        groupName: sdeGroups.name,
      })
      .from(sdeTypes)
      .innerJoin(sdeGroups, eq(sdeGroups.groupId, sdeTypes.groupId))
      .where(
        and(
          inArray(sdeTypes.typeId, uniqueTypeIds),
          eq(sdeTypes.published, true),
          eq(sdeGroups.published, true),
        ),
      )
      .orderBy(asc(sdeTypes.typeId))
      .limit(maxCoreSdeTypeIds)
  },
} satisfies SdeCoreReads
