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
  PlatformResourceMaintenanceContext,
  PlatformResourceMaterializationContext,
  PlatformResourceOperationImplementation,
} from '@eve-space/platform-module-contract/resources'
import { z } from 'zod'
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
type SkillSnapshotMaterializationContext = PlatformResourceMaterializationContext<
  TrainedSkillsData | SkillQueueData,
  PlatformCharacterResourceSubject,
  CurrentSnapshotPersistence
>
type EvidenceMaintenanceContext = PlatformResourceMaintenanceContext<EvidenceMaintenancePersistence>
type EvidencePurgeInput = Parameters<EvidenceMaintenancePersistence['purgeEvidence']>[0]
type WithoutLimit<Input> = Input extends unknown ? Omit<Input, 'limit'> : never
type EvidenceStore = Exclude<
  EvidencePurgeInput['store'],
  'continuations' | 'staging' | 'promotions'
>

export const trainedSkillsResource = {
  operation: 'skills',
  request(subject) {
    return { path: { character_id: subject.characterId } }
  },
  async map({ data, capabilities }) {
    const response = trainedSkillsResponseSchema.parse(data)
    const catalogue = await capabilities.coreData.publishedSkillCatalogue()
    return {
      kind: 'trained-skills' as const,
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
    return persistSkillSnapshot(
      'trained-skills',
      context as unknown as SkillSnapshotMaterializationContext,
    )
  },
  maintain(context) {
    return maintainEvidence(
      ['trained-skills', 'legacy-skills'],
      context as unknown as EvidenceMaintenanceContext,
      true,
    )
  },
} satisfies PlatformResourceOperationImplementation<
  'skills',
  unknown,
  TrainedSkillsData,
  string,
  unknown,
  PlatformCharacterResourceSubject,
  SkillProducts
>

export const skillQueueResource = {
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
      kind: 'skill-queue' as const,
      entries: projectSkillQueueEntries(response.map(mapQueueEntry), definitions),
    }
  },
  materialize(context) {
    return persistSkillSnapshot(
      'skill-queue',
      context as unknown as SkillSnapshotMaterializationContext,
    )
  },
  maintain(context) {
    return maintainEvidence('skill-queue', context as unknown as EvidenceMaintenanceContext, false)
  },
} satisfies PlatformResourceOperationImplementation<
  'skill-queue',
  unknown,
  SkillQueueData,
  string,
  unknown,
  PlatformCharacterResourceSubject,
  SkillProducts
>

export const assetsResource = {
  operation: 'character-assets-page',
  request(subject) {
    return { path: { character_id: subject.characterId } }
  },
  map({ data }) {
    return data
  },
  async materialize() {
    return { outcome: 'obsolete' as const }
  },
  maintain(context) {
    return maintainEvidence('assets', context as unknown as EvidenceMaintenanceContext, false)
  },
} satisfies PlatformResourceOperationImplementation<
  'character-assets-page',
  unknown,
  unknown,
  string,
  unknown,
  PlatformCharacterResourceSubject,
  readonly ['published-type-details', 'static-location-labels']
>

export const walletBalanceResource = {
  operation: 'wallet-balance',
  request(subject) {
    return { path: { character_id: subject.characterId } }
  },
  map({ data }) {
    return data
  },
  async materialize() {
    return { outcome: 'obsolete' as const }
  },
  maintain(context) {
    return maintainEvidence(
      'wallet-balance',
      context as unknown as EvidenceMaintenanceContext,
      false,
    )
  },
} satisfies PlatformResourceOperationImplementation<
  'wallet-balance',
  unknown,
  unknown,
  string,
  unknown,
  PlatformCharacterResourceSubject
>

export const walletJournalResource = {
  operation: 'wallet-journal',
  request(subject) {
    return { path: { character_id: subject.characterId } }
  },
  map({ data }) {
    return data
  },
  async materialize() {
    return { outcome: 'obsolete' as const }
  },
  maintain(context) {
    return maintainEvidence(
      'wallet-journal',
      context as unknown as EvidenceMaintenanceContext,
      false,
    )
  },
} satisfies PlatformResourceOperationImplementation<
  'wallet-journal',
  unknown,
  unknown,
  string,
  unknown,
  PlatformCharacterResourceSubject
>

export const walletTransactionsResource = {
  operation: 'wallet-transactions',
  request(subject) {
    return { path: { character_id: subject.characterId } }
  },
  map({ data }) {
    return data
  },
  async materialize() {
    return { outcome: 'obsolete' as const }
  },
  maintain(context) {
    return maintainEvidence(
      'wallet-transactions',
      context as unknown as EvidenceMaintenanceContext,
      false,
    )
  },
} satisfies PlatformResourceOperationImplementation<
  'wallet-transactions',
  unknown,
  unknown,
  string,
  unknown,
  PlatformCharacterResourceSubject
>

export const mailHeadersResource = {
  operation: 'mail-headers',
  request(subject) {
    return { path: { character_id: subject.characterId } }
  },
  map({ data }) {
    return data
  },
  async materialize() {
    return { outcome: 'obsolete' as const }
  },
  maintain(context) {
    return maintainEvidence('mail-headers', context as unknown as EvidenceMaintenanceContext, false)
  },
} satisfies PlatformResourceOperationImplementation<
  'mail-headers',
  unknown,
  unknown,
  string,
  unknown,
  PlatformCharacterResourceSubject
>

export const mailDetailsResource = {
  operation: 'mail-message',
  request() {
    throw new Error('Mail detail collection requires a continuation checkpoint')
  },
  map({ data }) {
    return data
  },
  async materialize() {
    return { outcome: 'obsolete' as const }
  },
  maintain(context) {
    return maintainEvidence(
      'mail-contents',
      context as unknown as EvidenceMaintenanceContext,
      false,
    )
  },
} satisfies PlatformResourceOperationImplementation<
  'mail-message',
  unknown,
  unknown,
  string,
  unknown,
  PlatformCharacterResourceSubject
>

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
    !authority ||
    context.organizationVersion !== authority.organizationVersion ||
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
  const result =
    resourceId === 'trained-skills' && context.data.kind === 'trained-skills'
      ? await context.capabilities.persistence.materializeCurrentSnapshot({
          ...common,
          resourceId,
          snapshot: context.data,
        })
      : resourceId === 'skill-queue' && context.data.kind === 'skill-queue'
        ? await context.capabilities.persistence.materializeCurrentSnapshot({
            ...common,
            resourceId,
            snapshot: context.data,
          })
        : { outcome: 'obsolete' as const }
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
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619) >>> 0
  }
  return hash
}

async function maintainEvidence(
  storeOrStores: EvidenceStore | readonly EvidenceStore[],
  context: EvidenceMaintenanceContext,
  purgeRetention: boolean,
) {
  if (purgeRetention && context.purgeRetention) await purgeExpiredEvidence(context)
  const stores = typeof storeOrStores === 'string' ? [storeOrStores] : storeOrStores
  const purges: WithoutLimit<EvidencePurgeInput>[] = []
  for (const store of stores) {
    for (const authority of context.invalidAuthorities)
      purges.push({ mode: 'authority', store, ...authority })
    for (const targetUserId of context.purgeAccountIds)
      purges.push({ mode: 'account', store, targetUserId })
  }
  for (const purge of purges) {
    context.signal?.throwIfAborted()
    // oxlint-disable-next-line no-await-in-loop -- A resource can issue overlapping account and authority purges.
    await purgeAllBatches(context, purge)
  }
}

async function purgeExpiredEvidence(context: EvidenceMaintenanceContext) {
  const now = new Date(context.now)
  if (Number.isNaN(now.getTime())) throw new Error('Evidence maintenance time is invalid')
  const retentionCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1_000).toISOString()
  const transientCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString()
  const purges: WithoutLimit<EvidencePurgeInput>[] = []
  for (const store of [
    'legacy-skills',
    'wallet-journal',
    'wallet-transactions',
    'mail-headers',
    'mail-contents',
  ] as const)
    purges.push({
      mode: 'retention',
      store,
      cutoff: store === 'legacy-skills' ? retentionCutoff : context.now,
    })
  for (const store of ['continuations', 'staging', 'promotions'] as const)
    purges.push({ mode: 'retention', store, cutoff: transientCutoff })
  for (const purge of purges) {
    // oxlint-disable-next-line no-await-in-loop -- Retention stores share promotion and staging rows.
    await purgeAllBatches(context, purge)
  }
}

async function purgeAllBatches(
  context: EvidenceMaintenanceContext,
  input: WithoutLimit<EvidencePurgeInput>,
) {
  context.signal?.throwIfAborted()
  const { remaining } = await context.capabilities.persistence.purgeEvidence({
    ...input,
    limit: 1_000,
  } as EvidencePurgeInput)
  if (remaining) await purgeAllBatches(context, input)
}
