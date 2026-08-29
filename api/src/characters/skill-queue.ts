import { createSkillsClient } from '@evespace/esi-client/domains/skills'
import type { GetCharactersCharacterIdSkillqueueOutput } from '@evespace/esi-client/schemas'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { sdeGroups, sdeTypeDogmaAttributes, sdeTypes } from '../db/schema.js'
import { getCharacterEsiScope } from '../esi-resilience/catalog.js'
import { getEsiResilienceLayer } from '../esi-resilience/resilience.js'
import { createEsiTransport } from '../esi-resilience/transport.js'

const primaryAttributeId = 180
const secondaryAttributeId = 181
const attributeNames = new Map<number, SkillAttribute>([
  [164, 'charisma'],
  [165, 'intelligence'],
  [166, 'memory'],
  [167, 'perception'],
  [168, 'willpower'],
])

type SkillAttribute = 'charisma' | 'intelligence' | 'memory' | 'perception' | 'willpower'

export const characterSkillQueueScope = getCharacterEsiScope('skill-queue')

type SkillQueueState = 'training' | 'paused' | 'empty' | 'lapsed'

export interface CharacterSkillQueueEntry {
  queuePosition: number
  typeId: number
  name: string
  groupId: number | null
  groupName: string
  finishedLevel: number
  levelStartSp: number | null
  levelEndSp: number | null
  trainingStartSp: number | null
  startDate: string | null
  finishDate: string | null
  primaryAttribute: SkillAttribute | null
  secondaryAttribute: SkillAttribute | null
}

interface CharacterSkillQueueEntries {
  entries: CharacterSkillQueueEntry[]
}

export interface CharacterSkillQueue extends CharacterSkillQueueEntries {
  state: SkillQueueState
  activeQueuePosition: number | null
}

/**
 * Classification depends on the current time, so it is resolved per response rather than stored in
 * the cached representation, which must stay time-independent for conditional revalidation.
 */
export function resolveSkillQueueState(
  entries: readonly CharacterSkillQueueEntry[],
  now: number,
): Pick<CharacterSkillQueue, 'activeQueuePosition' | 'state'> {
  if (entries.length === 0) return { state: 'empty', activeQueuePosition: null }
  if (entries.every((entry) => entry.startDate === null))
    return { state: 'paused', activeQueuePosition: null }

  const unfinished = entries.find(
    (entry) => entry.finishDate === null || Date.parse(entry.finishDate) > now,
  )
  if (!unfinished) return { state: 'lapsed', activeQueuePosition: null }
  if (unfinished.finishDate === null) return { state: 'paused', activeQueuePosition: null }
  return { state: 'training', activeQueuePosition: unfinished.queuePosition }
}

export async function getCharacterSkillQueue(characterId: number): Promise<CharacterSkillQueue> {
  const { entries } = (
    await getEsiResilienceLayer().getCharacter({
      operation: 'skill-queue',
      inputs: { characterId },
      load: async (authority, revalidation) => {
        const response = await createSkillsClient({
          fetch: createEsiTransport('skill-queue', authority.principal),
          token: authority.accessToken,
        })
          .withMetadata()
          .getSkillQueue(characterId, revalidation)
        return { data: await mapCharacterSkillQueue(response.data), meta: response.meta }
      },
    })
  ).data

  return { ...resolveSkillQueueState(entries, Date.now()), entries }
}

async function mapCharacterSkillQueue(
  result: GetCharactersCharacterIdSkillqueueOutput,
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
        inArray(sdeTypeDogmaAttributes.attributeId, [primaryAttributeId, secondaryAttributeId]),
      ),
    )
    .where(
      and(
        inArray(sdeTypes.typeId, typeIds),
        eq(sdeTypes.published, true),
        eq(sdeGroups.published, true),
      ),
    )

  const staticByType = new Map<
    number,
    {
      typeName: string
      groupId: number
      groupName: string
      primaryAttribute: SkillAttribute | null
      secondaryAttribute: SkillAttribute | null
    }
  >()
  for (const row of staticRows) {
    let skill = staticByType.get(row.typeId)
    if (!skill) {
      skill = {
        typeName: row.typeName,
        groupId: row.groupId,
        groupName: row.groupName,
        primaryAttribute: null,
        secondaryAttribute: null,
      }
      staticByType.set(row.typeId, skill)
    }
    const attribute = attributeNames.get(Math.trunc(row.attributeValue ?? Number.NaN)) ?? null
    if (row.attributeId === primaryAttributeId) skill.primaryAttribute = attribute
    if (row.attributeId === secondaryAttributeId) skill.secondaryAttribute = attribute
  }

  return {
    entries: result
      .map((entry) => {
        const staticSkill = staticByType.get(entry.skill_id)
        return {
          queuePosition: entry.queue_position,
          typeId: entry.skill_id,
          name: staticSkill?.typeName ?? `Unknown skill ${entry.skill_id}`,
          groupId: staticSkill?.groupId ?? null,
          groupName: staticSkill?.groupName ?? 'Unknown',
          finishedLevel: entry.finished_level,
          levelStartSp: entry.level_start_sp ?? null,
          levelEndSp: entry.level_end_sp ?? null,
          trainingStartSp: entry.training_start_sp ?? null,
          startDate: entry.start_date ?? null,
          finishDate: entry.finish_date ?? null,
          primaryAttribute: staticSkill?.primaryAttribute ?? null,
          secondaryAttribute: staticSkill?.secondaryAttribute ?? null,
        }
      })
      .toSorted(
        (left, right) => left.queuePosition - right.queuePosition || left.typeId - right.typeId,
      ),
  }
}
