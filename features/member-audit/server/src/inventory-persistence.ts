import type { PlatformPersistenceMethodsFor } from '@eve-space/platform-module-contract/persistence'
import { definePlatformPersistenceOperation } from '@eve-space/platform-module-server'
import { z } from 'zod'
import { reviewerAuthorityFields, writeEvidenceContinuationOperation } from './persistence.js'

const subjectSchema = z.strictObject({
  authorizationGeneration: reviewerAuthorityFields.authorizationGeneration,
  characterId: reviewerAuthorityFields.characterId,
  characterLifecycleId: reviewerAuthorityFields.characterLifecycleId,
  disclosureVersion: reviewerAuthorityFields.disclosureVersion,
  managedMemberLifecycleId: reviewerAuthorityFields.managedMemberLifecycleId,
  organizationVersion: reviewerAuthorityFields.organizationVersion,
  sectionActivationVersion: reviewerAuthorityFields.sectionActivationVersion,
  targetUserId: reviewerAuthorityFields.targetUserId,
  observationId: z.uuid().nullable(),
})
type InventoryPersistenceSubject = z.input<typeof subjectSchema>
const distinctSubjects = (subjects: readonly InventoryPersistenceSubject[]) =>
  new Set(subjects.map((subject) => subject.characterId)).size === subjects.length
const backfillSubjectsSchema = z.array(subjectSchema).max(20).refine(distinctSubjects)
const promoteInputSchema = z.strictObject({
  authorizationGeneration: reviewerAuthorityFields.authorizationGeneration,
  characterId: reviewerAuthorityFields.characterId,
  characterLifecycleId: reviewerAuthorityFields.characterLifecycleId,
  disclosureVersion: reviewerAuthorityFields.disclosureVersion,
  managedMemberLifecycleId: reviewerAuthorityFields.managedMemberLifecycleId,
  organizationVersion: reviewerAuthorityFields.organizationVersion,
  sectionActivationVersion: reviewerAuthorityFields.sectionActivationVersion,
  targetUserId: reviewerAuthorityFields.targetUserId,
  observationId: z.uuid(),
  operationContractRevision: z.number().int().positive(),
  resourceRevision: z.number().int().positive(),
  sectionId: z.literal('assets'),
  resourceId: z.literal('assets'),
  dtoRevision: z.literal(1),
  expectedRevision: z.number().int().positive(),
  validatedAt: z.iso.datetime({ offset: true }),
})
const subjectsSchema = z
  .array(subjectSchema)
  .max(250)
  .refine(
    (subjects) => new Set(subjects.map((subject) => subject.characterId)).size === subjects.length,
  )
const sourceSchema = z.strictObject({
  characterId: z.number().int().positive(),
  observationId: z.uuid().nullable(),
  validatedAt: z.iso.datetime({ offset: true }).nullable(),
  ready: z.boolean(),
})
const quantitySchema = z.templateLiteral([z.bigint()]).refine((value) => /^\d{1,40}$/.test(value))
const groupSchema = z.strictObject({
  key: z.string().max(256),
  typeId: z.number().int().positive(),
  typeName: z.string().max(500).nullable(),
  groupId: z.number().int().positive().nullable(),
  categoryId: z.number().int().positive().nullable(),
  blueprint: z.enum(['none', 'original', 'copy']),
  location: z.strictObject({
    key: z.string().max(100),
    id: z.string().nullable(),
    name: z.string().max(500).nullable(),
    state: z.enum(['resolved', 'unknown', 'restricted', 'unresolved']),
  }),
  currentQuantity: quantitySchema,
  staleQuantity: quantitySchema,
})
const holderSchema = z.strictObject({
  characterId: z.number().int().positive(),
  groupKey: z.string().max(256),
  currentQuantity: quantitySchema,
  staleQuantity: quantitySchema,
})

export const readInventorySourcesOperation = definePlatformPersistenceOperation({
  id: 'read-inventory-sources',
  method: 'readInventorySources',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject({ subjects: subjectsSchema }),
  outputSchema: z.array(sourceSchema).max(250),
  maximumInputBytes: 262144,
  maximumOutputBytes: 131072,
})
export const readAssetInventoryOperation = definePlatformPersistenceOperation({
  id: 'read-asset-inventory',
  method: 'readAssetInventory',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject({
    subjects: z
      .array(subjectSchema.extend({ observationId: z.uuid(), stale: z.boolean() }))
      .max(250)
      .refine(
        (subjects) =>
          new Set(subjects.map((subject) => subject.characterId)).size === subjects.length,
      ),
    kind: z.enum(['groups', 'holders', 'coverage']),
    first: z.number().int().min(1).max(100),
    after: z.string().max(256).nullable(),
    groupKey: z.string().max(256).nullable(),
    filters: z.strictObject({
      typeId: z.number().int().positive().optional(),
      groupId: z.number().int().positive().optional(),
      categoryId: z.number().int().positive().optional(),
      locationKey: z.string().max(100).optional(),
    }),
  }),
  outputSchema: z.strictObject({
    groups: z.array(groupSchema).max(100),
    holders: z.array(holderSchema).max(100),
    hasNextPage: z.boolean(),
    conflictingCharacters: z.array(z.number().int().positive()).max(250),
  }),
  maximumInputBytes: 262144,
  maximumOutputBytes: 262144,
})
export const backfillAssetInventoryOperation = definePlatformPersistenceOperation({
  id: 'backfill-asset-inventory',
  method: 'backfillAssetInventory',
  revision: 1,
  mode: 'write',
  inputSchema: z.strictObject({ subjects: backfillSubjectsSchema }),
  outputSchema: z.strictObject({ projected: z.number().int().nonnegative() }),
  maximumInputBytes: 32768,
  maximumOutputBytes: 256,
})
export const promoteAssetInventoryOperation = definePlatformPersistenceOperation({
  id: 'promote-asset-inventory',
  method: 'promoteAssetInventory',
  revision: 1,
  mode: 'write',
  inputSchema: promoteInputSchema,
  outputSchema: z.strictObject({ outcome: z.enum(['applied', 'obsolete']) }),
  maximumInputBytes: 4096,
  maximumOutputBytes: 256,
})
const operations = {
  'read-inventory-sources': readInventorySourcesOperation,
  'read-asset-inventory': readAssetInventoryOperation,
  'backfill-asset-inventory': backfillAssetInventoryOperation,
  'promote-asset-inventory': promoteAssetInventoryOperation,
  'write-evidence-continuation': writeEvidenceContinuationOperation,
} as const
export type InventoryReadPersistence = PlatformPersistenceMethodsFor<
  typeof operations,
  readonly ['read-inventory-sources', 'read-asset-inventory']
>
export type InventoryMaterializationPersistence = PlatformPersistenceMethodsFor<
  typeof operations,
  readonly ['backfill-asset-inventory', 'promote-asset-inventory', 'write-evidence-continuation']
>
