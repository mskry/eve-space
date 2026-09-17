import { operationRegistry } from '@evespace/esi-client/operations'
import type { GetCharactersCharacterIdSkillqueueResponse } from '@evespace/esi-client/types'
import {
  projectSkillQueueDefinitions,
  projectSkillQueueEntries,
  resolveSkillQueueState,
  type ProjectedSkillQueueEntry,
  type SkillQueueSourceEntry,
  type SkillQueueState,
} from '@eve-space/core-eve-projections/skill-queue'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { sdeGroups, sdeTypeDogmaAttributes, sdeTypes } from '../db/schema.js'
import {
  createCharacterEsiRead,
  toEsiReadResultMetadata,
  type EsiReadResultMetadata,
} from '../esi-gateway/feature-execution.js'
import { skillPrimaryAttributeId, skillSecondaryAttributeId } from '../skills/training.js'

interface CharacterSkillQueueRepresentationInput {
  characterId: number
  subjectLifecycleId: string
}

const skillAttributeCacheSchema = z.enum([
  'charisma',
  'intelligence',
  'memory',
  'perception',
  'willpower',
])
const characterSkillQueueCacheSchema = z.object({
  entries: z.array(
    z.object({
      queuePosition: z.number(),
      typeId: z.number(),
      name: z.string(),
      groupId: z.number().nullable(),
      groupName: z.string(),
      finishedLevel: z.number(),
      levelStartSp: z.number().nullable(),
      levelEndSp: z.number().nullable(),
      trainingStartSp: z.number().nullable(),
      startDate: z.string().nullable(),
      finishDate: z.string().nullable(),
      primaryAttribute: skillAttributeCacheSchema.nullable(),
      secondaryAttribute: skillAttributeCacheSchema.nullable(),
    }),
  ),
})

const characterSkillQueueRead = createCharacterEsiRead({
  operation: 'skill-queue',
  name: 'character-skill-queue-core',
  descriptor: operationRegistry.GetCharactersCharacterIdSkillqueue.transport,
  cacheSchema: characterSkillQueueCacheSchema,
  encodeRequest: (input: CharacterSkillQueueRepresentationInput) => ({
    path: { character_id: input.characterId },
  }),
  map: (response) => mapCharacterSkillQueue(response.data),
})

export const characterSkillQueueScope = characterSkillQueueRead.requiredScope

interface CharacterSkillQueueEntries {
  entries: ProjectedSkillQueueEntry[]
}

interface CharacterSkillQueueData extends CharacterSkillQueueEntries {
  state: SkillQueueState
  activeQueuePosition: number | null
}

type CharacterSkillQueue = CharacterSkillQueueData & EsiReadResultMetadata

export async function getCharacterSkillQueue(
  characterId: number,
  subjectLifecycleId: string,
): Promise<CharacterSkillQueue> {
  const result = await characterSkillQueueRead.execute({ characterId, subjectLifecycleId })

  return {
    ...resolveSkillQueueState(result.data.entries, Date.now()),
    entries: result.data.entries,
    ...toEsiReadResultMetadata(result),
  }
}

async function mapCharacterSkillQueue(
  result: GetCharactersCharacterIdSkillqueueResponse,
): Promise<CharacterSkillQueueEntries> {
  if (result.length === 0) return { entries: [] }

  const typeIds = [...new Set(result.map((entry) => entry.skill_id))]
  const staticRows = await db
    .select({
      typeId: sdeTypes.typeId,
      typeName: sdeTypes.name,
      groupId: sdeGroups.groupId,
      groupName: sdeGroups.name,
      attributeId: sdeTypeDogmaAttributes.attributeId,
      attributeValue: sdeTypeDogmaAttributes.value,
    })
    .from(sdeTypes)
    .innerJoin(sdeGroups, eq(sdeGroups.groupId, sdeTypes.groupId))
    .leftJoin(
      sdeTypeDogmaAttributes,
      and(
        eq(sdeTypeDogmaAttributes.typeId, sdeTypes.typeId),
        inArray(sdeTypeDogmaAttributes.attributeId, [
          skillPrimaryAttributeId,
          skillSecondaryAttributeId,
        ]),
      ),
    )
    .where(
      and(
        inArray(sdeTypes.typeId, typeIds),
        eq(sdeTypes.published, true),
        eq(sdeGroups.published, true),
      ),
    )

  return {
    entries: projectSkillQueueEntries(
      result.map((entry): SkillQueueSourceEntry => ({
        queuePosition: entry.queue_position,
        typeId: entry.skill_id,
        finishedLevel: entry.finished_level,
        levelStartSp: entry.level_start_sp ?? null,
        levelEndSp: entry.level_end_sp ?? null,
        trainingStartSp: entry.training_start_sp ?? null,
        startDate: entry.start_date ?? null,
        finishDate: entry.finish_date ?? null,
      })),
      projectSkillQueueDefinitions(staticRows),
    ),
  }
}
