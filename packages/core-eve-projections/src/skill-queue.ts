import {
  skillAttributeFromDogmaValue,
  skillPrimaryAttributeId,
  skillSecondaryAttributeId,
  type SkillAttribute,
} from './skill-training.js'

export type SkillQueueState = 'training' | 'paused' | 'empty' | 'lapsed'

export interface SkillQueueSourceEntry {
  readonly queuePosition: number
  readonly typeId: number
  readonly finishedLevel: number
  readonly levelStartSp: number | null
  readonly levelEndSp: number | null
  readonly trainingStartSp: number | null
  readonly startDate: string | null
  readonly finishDate: string | null
}

export interface SkillQueueDefinitionRow {
  readonly typeId: number
  readonly typeName: string
  readonly groupId: number
  readonly groupName: string
  readonly attributeId: number | null
  readonly attributeValue: number | null
}

export interface SkillQueueDefinition {
  readonly typeId: number
  readonly name: string
  readonly groupId: number
  readonly groupName: string
  readonly primaryAttribute: SkillAttribute | null
  readonly secondaryAttribute: SkillAttribute | null
}

export interface ProjectedSkillQueueEntry extends SkillQueueSourceEntry {
  readonly name: string
  readonly groupId: number | null
  readonly groupName: string
  readonly primaryAttribute: SkillAttribute | null
  readonly secondaryAttribute: SkillAttribute | null
}

export function projectSkillQueueDefinitions(
  rows: readonly SkillQueueDefinitionRow[],
): SkillQueueDefinition[] {
  const definitions = new Map<number, SkillQueueDefinition>()
  for (const row of rows) {
    const current = definitions.get(row.typeId) ?? {
      typeId: row.typeId,
      name: row.typeName,
      groupId: row.groupId,
      groupName: row.groupName,
      primaryAttribute: null,
      secondaryAttribute: null,
    }
    const attribute = skillAttributeFromDogmaValue(row.attributeValue)
    definitions.set(row.typeId, {
      ...current,
      primaryAttribute:
        row.attributeId === skillPrimaryAttributeId ? attribute : current.primaryAttribute,
      secondaryAttribute:
        row.attributeId === skillSecondaryAttributeId ? attribute : current.secondaryAttribute,
    })
  }
  return [...definitions.values()].toSorted((left, right) => left.typeId - right.typeId)
}

export function projectSkillQueueEntries(
  entries: readonly SkillQueueSourceEntry[],
  definitions: readonly SkillQueueDefinition[],
): ProjectedSkillQueueEntry[] {
  const definitionsByType = new Map(
    definitions.map((definition) => [definition.typeId, definition]),
  )
  return entries
    .map((entry) => {
      const definition = definitionsByType.get(entry.typeId)
      return {
        ...entry,
        name: definition?.name ?? `Unknown skill ${entry.typeId}`,
        groupId: definition?.groupId ?? null,
        groupName: definition?.groupName ?? 'Unknown',
        primaryAttribute: definition?.primaryAttribute ?? null,
        secondaryAttribute: definition?.secondaryAttribute ?? null,
      }
    })
    .toSorted(
      (left, right) => left.queuePosition - right.queuePosition || left.typeId - right.typeId,
    )
}

export function resolveSkillQueueState(
  entries: readonly ProjectedSkillQueueEntry[],
  now: number,
): { readonly state: SkillQueueState; readonly activeQueuePosition: number | null } {
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
