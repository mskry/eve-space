import {
  projectTrainedSkills,
  type ProjectedTrainedSkills,
} from '@eve-space/core-eve-projections/trained-skills'
import type {
  PlatformCharacterResourceSubject,
  PlatformResourceMaterializationContext,
  PlatformSingleRequestResourceImplementation,
} from '@eve-space/platform-module-contract/resources'
import type { PlatformCoreEsiOperationProtocol } from '@eve-space/platform-module-server'
import { z } from 'zod'
import { maintainEvidence } from './evidence-maintenance.js'
import { createObservationId } from './observation-identity.js'
import type { CurrentSnapshotPersistence, EvidenceMaintenancePersistence } from './persistence.js'

const trainedSkillsResponseSchema = z.strictObject({
  skills: z.array(
    z.strictObject({
      skill_id: z.number().int().positive(),
      active_skill_level: z.number().int().min(0).max(5),
      trained_skill_level: z.number().int().min(0).max(5),
      skillpoints_in_skill: z.number().int().nonnegative(),
    }),
  ),
  total_sp: z.number().int().nonnegative(),
  unallocated_sp: z.number().int().nonnegative().optional(),
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
type TrainedSkillsResource = PlatformSingleRequestResourceImplementation<
  'skills',
  PlatformCoreEsiOperationProtocol<'skills'>,
  TrainedSkillsData,
  string,
  unknown,
  PlatformCharacterResourceSubject,
  SkillProducts,
  CurrentSnapshotPersistence,
  EvidenceMaintenancePersistence
>
type SkillSnapshotMaterializationContext = PlatformResourceMaterializationContext<
  TrainedSkillsData,
  PlatformCharacterResourceSubject,
  CurrentSnapshotPersistence
>

export const trainedSkillsResource: TrainedSkillsResource = {
  maintain(context) {
    return maintainEvidence('trained-skills', context, true)
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
  mode: 'single-request',
  operation: 'skills',
  request(subject) {
    return { path: { character_id: subject.characterId } }
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
        name: skill.typeName,
        primaryAttribute: skill.primaryAttribute,
        rank: skill.rank,
        secondaryAttribute: skill.secondaryAttribute,
        typeId: skill.typeId,
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
  ) {
    return { outcome: 'obsolete' }
  }
  const common = {
    authorizationGeneration: context.authorizationGeneration,
    characterId: context.subject.characterId,
    characterLifecycleId: context.subject.lifecycleId,
    disclosureVersion: authority.disclosureVersion,
    dtoRevision: 1,
    managedMemberLifecycleId: authority.managedMemberLifecycleId,
    observationId: createObservationId(
      resourceId,
      context.subject.lifecycleId,
      context.validatedAt,
    ),
    organizationVersion: authority.organizationVersion,
    sectionActivationVersion: authority.sectionActivationVersion,
    targetUserId: authority.targetUserId,
    validatedAt: context.validatedAt,
  }
  const result = await context.capabilities.persistence.materializeCurrentSnapshot({
    ...common,
    resourceId,
    snapshot: context.data,
  })
  return result.outcome === 'obsolete' ? { outcome: 'obsolete' } : undefined
}
