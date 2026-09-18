import {
  projectSkillQueueEntries,
  type ProjectedSkillQueueEntry,
  type SkillQueueSourceEntry,
} from '@eve-space/core-eve-projections/skill-queue'
import {
  projectTrainedSkills,
  type ProjectedTrainedSkills,
} from '@eve-space/core-eve-projections/trained-skills'
import type {
  PlatformCharacterResourceSubject,
  PlatformResourceMaterializationContext,
  PlatformResourceOperationImplementation,
} from '@eve-space/platform-module-contract/resources'
import { z } from 'zod'
import { maintainEvidence } from './evidence-maintenance.js'
import type { CurrentSnapshotPersistence, EvidenceMaintenancePersistence } from './persistence.js'

const trainedSkillsResponseSchema = z.strictObject({
  total_sp: z.number().int().nonnegative(),
  unallocated_sp: z.number().int().nonnegative().optional(),
  skills: z.array(
    z.strictObject({
      skill_id: z.number().int().positive(),
      active_skill_level: z.number().int().min(0).max(5),
      trained_skill_level: z.number().int().min(0).max(5),
      skillpoints_in_skill: z.number().int().nonnegative(),
    }),
  ),
})
const queueResponseSchema = z.array(
  z.strictObject({
    queue_position: z.number().int().nonnegative(),
    skill_id: z.number().int().positive(),
    finished_level: z.number().int().min(1).max(5),
    level_start_sp: z.number().int().nonnegative().optional(),
    level_end_sp: z.number().int().nonnegative().optional(),
    training_start_sp: z.number().int().nonnegative().optional(),
    start_date: z.string().optional(),
    finish_date: z.string().optional(),
  }),
)

type SkillProducts = readonly ['published-skill-catalogue']
type TrainedSkillsData = { readonly kind: 'trained-skills' } & ProjectedTrainedSkills
interface SkillQueueData {
  readonly kind: 'skill-queue'
  readonly entries: ProjectedSkillQueueEntry[]
}
interface PublishedSkillRow {
  readonly typeId: number
  readonly typeName: string
  readonly groupId: number
  readonly groupName: string
  readonly rank: number | null
  readonly primaryAttribute: ProjectedSkillQueueEntry['primaryAttribute']
  readonly secondaryAttribute: ProjectedSkillQueueEntry['secondaryAttribute']
}
type SkillResource<Operation extends string, Data> = PlatformResourceOperationImplementation<
  Operation,
  unknown,
  Data,
  string,
  unknown,
  PlatformCharacterResourceSubject,
  SkillProducts,
  object,
  CurrentSnapshotPersistence,
  EvidenceMaintenancePersistence
>
type SkillSnapshotMaterializationContext = PlatformResourceMaterializationContext<
  TrainedSkillsData | SkillQueueData,
  PlatformCharacterResourceSubject,
  CurrentSnapshotPersistence
>

export const trainedSkillsResource: SkillResource<'skills', TrainedSkillsData> = {
  operation: 'skills',
  request(subject) {
    return { path: { character_id: subject.characterId } }
  },
  async map({ data, capabilities }) {
    const response = trainedSkillsResponseSchema.parse(data)
    const catalogue = await capabilities.coreData.publishedSkillCatalogue()
    return {
      kind: 'trained-skills',
      ...projectTrainedSkills(
        {
          totalSp: response.total_sp,
          unallocatedSp: response.unallocated_sp ?? 0,
          skills: response.skills.map((skill) => ({
            typeId: skill.skill_id,
            activeLevel: skill.active_skill_level,
            trainedLevel: skill.trained_skill_level,
            skillpoints: skill.skillpoints_in_skill,
          })),
        },
        catalogueFromRows(catalogue.rows),
      ),
    }
  },
  materialize(context) {
    return persistSkillSnapshot('trained-skills', context)
  },
  maintain(context) {
    return maintainEvidence(['trained-skills', 'legacy-skills'], context, true)
  },
}

export const skillQueueResource: SkillResource<'skill-queue', SkillQueueData> = {
  operation: 'skill-queue',
  request(subject) {
    return { path: { character_id: subject.characterId } }
  },
  async map({ data, capabilities }) {
    const response = queueResponseSchema.parse(data)
    const catalogue = await capabilities.coreData.publishedSkillCatalogue()
    const definitions = catalogue.rows.map((skill) => ({
      typeId: skill.typeId,
      name: skill.typeName,
      groupId: skill.groupId,
      groupName: skill.groupName,
      primaryAttribute: skill.primaryAttribute,
      secondaryAttribute: skill.secondaryAttribute,
    }))
    return {
      kind: 'skill-queue',
      entries: projectSkillQueueEntries(response.map(mapQueueEntry), definitions),
    }
  },
  materialize(context) {
    return persistSkillSnapshot('skill-queue', context)
  },
  maintain(context) {
    return maintainEvidence('skill-queue', context, false)
  },
}

function catalogueFromRows(rows: readonly PublishedSkillRow[]) {
  const groups = new Map<
    number,
    { groupId: number; name: string; skills: (typeof rows)[number][] }
  >()
  for (const skill of rows) {
    const group = groups.get(skill.groupId) ?? {
      groupId: skill.groupId,
      name: skill.groupName,
      skills: [],
    }
    group.skills.push(skill)
    groups.set(skill.groupId, group)
  }
  return {
    groups: [...groups.values()].map((group) => ({
      groupId: group.groupId,
      name: group.name,
      skills: group.skills.map((skill) => ({
        typeId: skill.typeId,
        name: skill.typeName,
        rank: skill.rank,
        primaryAttribute: skill.primaryAttribute,
        secondaryAttribute: skill.secondaryAttribute,
      })),
    })),
  }
}

function mapQueueEntry(entry: z.infer<typeof queueResponseSchema>[number]): SkillQueueSourceEntry {
  return {
    queuePosition: entry.queue_position,
    typeId: entry.skill_id,
    finishedLevel: entry.finished_level,
    levelStartSp: entry.level_start_sp ?? null,
    levelEndSp: entry.level_end_sp ?? null,
    trainingStartSp: entry.training_start_sp ?? null,
    startDate: entry.start_date ?? null,
    finishDate: entry.finish_date ?? null,
  }
}

async function persistSkillSnapshot(
  resourceId: 'trained-skills' | 'skill-queue',
  context: SkillSnapshotMaterializationContext,
): Promise<void | { readonly outcome: 'obsolete' }> {
  const authority = context.managedAuthority
  if (
    context.organizationVersion !== authority?.organizationVersion ||
    context.authorizationGeneration === null
  )
    return { outcome: 'obsolete' }
  const common = {
    organizationVersion: authority.organizationVersion,
    targetUserId: authority.targetUserId,
    managedMemberLifecycleId: authority.managedMemberLifecycleId,
    characterId: context.subject.characterId,
    characterLifecycleId: context.subject.lifecycleId,
    authorizationGeneration: context.authorizationGeneration,
    disclosureVersion: authority.disclosureVersion,
    sectionActivationVersion: authority.sectionActivationVersion,
    observationId: observationId(context, resourceId),
    dtoRevision: 1,
    validatedAt: context.validatedAt,
  }
  let result
  if (resourceId === 'trained-skills' && context.data.kind === 'trained-skills') {
    result = await context.capabilities.persistence.materializeCurrentSnapshot({
      ...common,
      resourceId,
      snapshot: context.data,
    })
  } else if (resourceId === 'skill-queue' && context.data.kind === 'skill-queue') {
    result = await context.capabilities.persistence.materializeCurrentSnapshot({
      ...common,
      resourceId,
      snapshot: context.data,
    })
  } else {
    result = { outcome: 'obsolete' as const }
  }
  return result.outcome === 'obsolete' ? { outcome: 'obsolete' } : undefined
}

function observationId(
  context: SkillSnapshotMaterializationContext,
  resourceId: 'trained-skills' | 'skill-queue',
) {
  const source = `${resourceId}:${context.subject.lifecycleId}:${context.validatedAt}`
  const hex = [0, 1, 2, 3]
    .map((salt) => hashObservationIdentity(source, salt).toString(16).padStart(8, '0'))
    .join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`
}

function hashObservationIdentity(value: string, salt: number) {
  let hash = (2_166_136_261 + salt * 16_777_619) >>> 0
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.codePointAt(index)!
    hash = Math.imul(hash, 16_777_619) >>> 0
  }
  return hash
}
