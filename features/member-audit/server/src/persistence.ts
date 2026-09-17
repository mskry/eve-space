import type { PlatformPersistenceMethodsFor } from '@eve-space/platform-module-contract/persistence'
import {
  definePlatformPersistenceOperation,
  platformPersistencePayloadMaximumBytes,
} from '@eve-space/platform-module-server'
import { z } from 'zod'

const instantSchema = z.iso.datetime({ offset: true })
const skillAttributeSchema = z.enum([
  'charisma',
  'intelligence',
  'memory',
  'perception',
  'willpower',
])
const projectedSkillSchema = z.strictObject({
  typeId: z.number().int().positive(),
  name: z.string().min(1).max(500),
  injected: z.boolean(),
  activeLevel: z.number().int().min(0).max(5),
  trainedLevel: z.number().int().min(0).max(5),
  skillpoints: z.number().int().nonnegative(),
  rank: z.number().positive().nullable(),
  primaryAttribute: z.nullable(skillAttributeSchema),
  secondaryAttribute: z.nullable(skillAttributeSchema),
})
const trainedSkillsSchema = z.strictObject({
  kind: z.literal('trained-skills'),
  totalSp: z.number().int().nonnegative(),
  unallocatedSp: z.number().int().nonnegative(),
  injectedSkillCount: z.number().int().nonnegative(),
  groups: z.array(
    z.strictObject({
      groupId: z.number().int().positive().nullable(),
      name: z.string().min(1).max(500),
      trainedSp: z.number().int().nonnegative(),
      skills: z.array(projectedSkillSchema).max(10_000),
    }),
  ),
})
const queueEntrySchema = z.strictObject({
  queuePosition: z.number().int().nonnegative(),
  typeId: z.number().int().positive(),
  name: z.string().min(1).max(500),
  groupId: z.number().int().positive().nullable(),
  groupName: z.string().min(1).max(500),
  finishedLevel: z.number().int().min(1).max(5),
  levelStartSp: z.number().int().nonnegative().nullable(),
  levelEndSp: z.number().int().nonnegative().nullable(),
  trainingStartSp: z.number().int().nonnegative().nullable(),
  startDate: z.nullable(instantSchema),
  finishDate: z.nullable(instantSchema),
  primaryAttribute: z.nullable(skillAttributeSchema),
  secondaryAttribute: z.nullable(skillAttributeSchema),
})
const skillQueueSchema = z.strictObject({
  kind: z.literal('skill-queue'),
  entries: z.array(queueEntrySchema).max(10_000),
})

export const writeSkillSnapshotOperation = definePlatformPersistenceOperation({
  id: 'write-skill-snapshot',
  method: 'writeSkillSnapshot',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject({
    resourceId: z.enum(['trained-skills', 'skill-queue']),
    organizationVersion: z.number().int().positive(),
    targetUserId: z.uuid(),
    managedMemberLifecycleId: z.uuid(),
    characterId: z.number().int().positive(),
    characterLifecycleId: z.uuid(),
    authorizationGeneration: z.number().int().nonnegative(),
    disclosureVersion: z.number().int().positive(),
    sectionActivationVersion: z.number().int().positive(),
    dtoRevision: z.literal(1),
    validatedAt: instantSchema,
    snapshot: z.discriminatedUnion('kind', [trainedSkillsSchema, skillQueueSchema]),
  }),
  outputSchema: z.strictObject({ outcome: z.enum(['applied', 'obsolete']) }),
  maximumInputBytes: platformPersistencePayloadMaximumBytes,
  maximumOutputBytes: 256,
})

const persistenceOperations = { 'write-skill-snapshot': writeSkillSnapshotOperation } as const

export type SkillSnapshotPersistence = PlatformPersistenceMethodsFor<
  typeof persistenceOperations,
  readonly ['write-skill-snapshot']
>
