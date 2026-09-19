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
import { createObservationId } from './observation-identity.js'
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
type SkillProducts = readonly ['published-skill-catalogue']
type TrainedSkillsData = { readonly kind: 'trained-skills' } & ProjectedTrainedSkills
interface PublishedSkillRow {
  readonly typeId: number
  readonly typeName: string
  readonly groupId: number
  readonly groupName: string
  readonly rank: number | null
  readonly primaryAttribute:
    | 'charisma'
    | 'intelligence'
    | 'memory'
    | 'perception'
    | 'willpower'
    | null
  readonly secondaryAttribute:
    | 'charisma'
    | 'intelligence'
    | 'memory'
    | 'perception'
    | 'willpower'
    | null
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
  TrainedSkillsData,
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
    return maintainEvidence('trained-skills', context, true)
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

async function persistSkillSnapshot(
  resourceId: 'trained-skills',
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
    observationId: createObservationId(
      resourceId,
      context.subject.lifecycleId,
      context.validatedAt,
    ),
    dtoRevision: 1,
    validatedAt: context.validatedAt,
  }
  const result = await context.capabilities.persistence.materializeCurrentSnapshot({
    ...common,
    resourceId,
    snapshot: context.data,
  })
  return result.outcome === 'obsolete' ? { outcome: 'obsolete' } : undefined
}
