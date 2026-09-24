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
  activeLevel: z.number().int().min(0).max(5),
  injected: z.boolean(),
  name: z.string().min(1).max(500),
  primaryAttribute: z.nullable(skillAttributeSchema),
  rank: z.number().positive().nullable(),
  secondaryAttribute: z.nullable(skillAttributeSchema),
  skillpoints: z.number().int().nonnegative(),
  trainedLevel: z.number().int().min(0).max(5),
  typeId: z.number().int().positive(),
})
const trainedSkillsSchema = z.strictObject({
  groups: z.array(
    z.strictObject({
      groupId: z.number().int().positive().nullable(),
      name: z.string().min(1).max(500),
      trainedSp: z.number().int().nonnegative(),
      skills: z.array(projectedSkillSchema).max(10_000),
    }),
  ),
  injectedSkillCount: z.number().int().nonnegative(),
  kind: z.literal('trained-skills'),
  totalSp: z.number().int().nonnegative(),
  unallocatedSp: z.number().int().nonnegative(),
})
const queueEntrySchema = z.strictObject({
  finishDate: z.nullable(instantSchema),
  finishedLevel: z.number().int().min(1).max(5),
  groupId: z.number().int().positive().nullable(),
  groupName: z.string().min(1).max(500),
  levelEndSp: z.number().int().nonnegative().nullable(),
  levelStartSp: z.number().int().nonnegative().nullable(),
  name: z.string().min(1).max(500),
  primaryAttribute: z.nullable(skillAttributeSchema),
  queuePosition: z.number().int().nonnegative(),
  secondaryAttribute: z.nullable(skillAttributeSchema),
  startDate: z.nullable(instantSchema),
  trainingStartSp: z.number().int().nonnegative().nullable(),
  typeId: z.number().int().positive(),
})
const skillQueueSchema = z.strictObject({
  entries: z.array(queueEntrySchema).max(10_000),
  kind: z.literal('skill-queue'),
})
const evidenceScalarSchema = z.union([z.string().max(100_000), z.number(), z.boolean(), z.null()])
const intentionalEvidenceRecordSchema = z
  .record(
    z.string().min(1).max(100),
    z.union([evidenceScalarSchema, z.array(evidenceScalarSchema).max(1000)]),
  )
  .refine((record) => Object.keys(record).length <= 64)
const assetSnapshotSchema = z.strictObject({
  kind: z.literal('assets'),
  records: z.array(intentionalEvidenceRecordSchema).max(10_000),
})
const walletBalanceSnapshotSchema = z.strictObject({
  balance: z.number(),
  kind: z.literal('wallet-balance'),
})
const authorityShape = {
  authorizationGeneration: z.number().int().nonnegative(),
  characterId: z.number().int().positive(),
  characterLifecycleId: z.uuid(),
  disclosureVersion: z.number().int().positive(),
  managedMemberLifecycleId: z.uuid(),
  organizationVersion: z.number().int().positive(),
  sectionActivationVersion: z.number().int().positive(),
  targetUserId: z.uuid(),
} as const
const boundedRecordListSchema = z.array(intentionalEvidenceRecordSchema).max(500)
const maximumStagedPageRecords = 2500
const continuationResourceSchema = z.discriminatedUnion('sectionId', [
  z.strictObject({ resourceId: z.literal('assets'), sectionId: z.literal('assets') }),
  z.strictObject({
    resourceId: z.enum(['wallet-journal', 'wallet-transactions']),
    sectionId: z.literal('wallet'),
  }),
  z.strictObject({
    resourceId: z.enum(['mail-headers', 'mail-details']),
    sectionId: z.literal('mail'),
  }),
])
const continuationIdentityShape = {
  authorizationGeneration: z.number().int().nonnegative(),
  characterId: z.number().int().positive(),
  characterLifecycleId: z.uuid(),
  disclosureVersion: z.number().int().positive(),
  managedMemberLifecycleId: z.uuid(),
  observationId: z.uuid(),
  operationContractRevision: z.number().int().positive(),
  organizationVersion: z.number().int().positive(),
  resourceRevision: z.number().int().positive(),
  sectionActivationVersion: z.number().int().positive(),
  targetUserId: z.uuid(),
} as const
const continuationIdentitySchema = z.strictObject(continuationIdentityShape)
const continuationCheckpointSchema = z
  .record(z.string().min(1).max(100), z.json())
  .refine((checkpoint) => Object.keys(checkpoint).length <= 64)
const assetStagedRecordSchema = z.strictObject({
  evidence: intentionalEvidenceRecordSchema,
  recordKind: z.literal('asset'),
  sourceId: z.string().min(1).max(200),
  sourceTimestamp: z.nullable(instantSchema),
  validatedAt: instantSchema,
})
const walletJournalStagedRecordSchema = z.strictObject({
  evidence: intentionalEvidenceRecordSchema,
  recordKind: z.literal('wallet-journal'),
  sourceId: z.string().min(1).max(200),
  sourceTimestamp: z.nullable(instantSchema),
  validatedAt: instantSchema,
})
const walletTransactionStagedRecordSchema = z.strictObject({
  evidence: intentionalEvidenceRecordSchema,
  recordKind: z.literal('wallet-transaction'),
  sourceId: z.string().min(1).max(200),
  sourceTimestamp: z.nullable(instantSchema),
  validatedAt: instantSchema,
})
const mailHeaderStagedRecordSchema = z.strictObject({
  evidence: intentionalEvidenceRecordSchema,
  recordKind: z.literal('mail-header'),
  sourceId: z.string().min(1).max(200),
  sourceTimestamp: z.nullable(instantSchema),
  validatedAt: instantSchema,
})
const mailContentStagedRecordSchema = z.strictObject({
  evidence: intentionalEvidenceRecordSchema,
  recordKind: z.literal('mail-content'),
  sourceId: z.string().min(1).max(200),
  sourceTimestamp: z.nullable(instantSchema),
  validatedAt: instantSchema,
})
const authoritySchema = z.strictObject(authorityShape)
const trainedSkillsEnvelopeSchema = z.strictObject({
  dtoRevision: z.number().int().positive(),
  observationId: z.uuid(),
  snapshot: trainedSkillsSchema,
  validatedAt: instantSchema,
})
const assetEnvelopeSchema = z.strictObject({
  dtoRevision: z.number().int().positive(),
  observationId: z.uuid(),
  snapshot: assetSnapshotSchema,
  validatedAt: instantSchema,
})
const nullableAssetEnvelopeSchema = z.nullable(assetEnvelopeSchema)
const walletBalanceEnvelopeSchema = z.strictObject({
  dtoRevision: z.number().int().positive(),
  observationId: z.uuid(),
  snapshot: walletBalanceSnapshotSchema,
  validatedAt: instantSchema,
})
const readTrainedSkillsEvidenceOutputSchema = z.strictObject({
  trainedSkills: z.nullable(trainedSkillsEnvelopeSchema),
})
const boundedEvidenceReadInputSchema = z.intersection(
  authoritySchema,
  z.strictObject({ limit: z.number().int().min(1).max(500) }),
)
const readWalletEvidenceOutputSchema = z.strictObject({
  balance: z.nullable(walletBalanceEnvelopeSchema),
  journal: boundedRecordListSchema,
  transactions: boundedRecordListSchema,
})
const readMailEvidenceOutputSchema = z.strictObject({
  contents: boundedRecordListSchema,
  headers: boundedRecordListSchema,
})

export type MemberAuditTrainedSkillsEvidence = z.infer<typeof readTrainedSkillsEvidenceOutputSchema>
export type MemberAuditAssetEvidence = z.infer<typeof nullableAssetEnvelopeSchema>
export type MemberAuditWalletEvidence = z.infer<typeof readWalletEvidenceOutputSchema>
export type MemberAuditMailEvidence = z.infer<typeof readMailEvidenceOutputSchema>

const materializeCurrentSnapshotInputSchema = z.discriminatedUnion('resourceId', [
  z.strictObject({
    authorizationGeneration: z.number().int().nonnegative(),
    characterId: z.number().int().positive(),
    characterLifecycleId: z.uuid(),
    disclosureVersion: z.number().int().positive(),
    dtoRevision: z.number().int().positive(),
    managedMemberLifecycleId: z.uuid(),
    observationId: z.uuid(),
    organizationVersion: z.number().int().positive(),
    resourceId: z.literal('trained-skills'),
    sectionActivationVersion: z.number().int().positive(),
    snapshot: trainedSkillsSchema,
    targetUserId: z.uuid(),
    validatedAt: instantSchema,
  }),
  z.strictObject({
    authorizationGeneration: z.number().int().nonnegative(),
    characterId: z.number().int().positive(),
    characterLifecycleId: z.uuid(),
    disclosureVersion: z.number().int().positive(),
    dtoRevision: z.number().int().positive(),
    managedMemberLifecycleId: z.uuid(),
    observationId: z.uuid(),
    organizationVersion: z.number().int().positive(),
    resourceId: z.literal('wallet-balance'),
    sectionActivationVersion: z.number().int().positive(),
    snapshot: walletBalanceSnapshotSchema,
    targetUserId: z.uuid(),
    validatedAt: instantSchema,
  }),
])
const readEvidenceContinuationInputSchema = z.intersection(
  continuationResourceSchema,
  continuationIdentitySchema,
)
const readEvidenceContinuationOutputSchema = z
  .strictObject({
    checkpoint: continuationCheckpointSchema,
    revision: z.number().int().nonnegative(),
  })
  .nullable()
const readActiveEvidenceContinuationInputSchema = z.intersection(
  continuationResourceSchema,
  z.intersection(
    z.strictObject({
      operationContractRevision: z.number().int().positive(),
      resourceRevision: z.number().int().positive(),
    }),
    authoritySchema,
  ),
)
const readActiveEvidenceContinuationOutputSchema = z
  .strictObject({
    checkpoint: continuationCheckpointSchema,
    observationId: z.uuid(),
    revision: z.number().int().nonnegative(),
  })
  .nullable()
const stagedRecordsByResourceSchema = z.discriminatedUnion('resourceId', [
  z.strictObject({
    records: z.array(assetStagedRecordSchema).max(maximumStagedPageRecords),
    resourceId: z.literal('assets'),
    sectionId: z.literal('assets'),
  }),
  z.strictObject({
    records: z.array(walletJournalStagedRecordSchema).max(maximumStagedPageRecords),
    resourceId: z.literal('wallet-journal'),
    sectionId: z.literal('wallet'),
  }),
  z.strictObject({
    records: z.array(walletTransactionStagedRecordSchema).max(maximumStagedPageRecords),
    resourceId: z.literal('wallet-transactions'),
    sectionId: z.literal('wallet'),
  }),
  z.strictObject({
    records: z.array(mailHeaderStagedRecordSchema).max(500),
    resourceId: z.literal('mail-headers'),
    sectionId: z.literal('mail'),
  }),
  z.strictObject({
    records: z.array(mailContentStagedRecordSchema).max(500),
    resourceId: z.literal('mail-details'),
    sectionId: z.literal('mail'),
  }),
])
const writeEvidenceContinuationInputSchema = z.intersection(
  continuationIdentitySchema,
  z.intersection(
    stagedRecordsByResourceSchema,
    z.strictObject({
      checkpoint: continuationCheckpointSchema,
      expectedRevision: z.number().int().nonnegative(),
      updatedAt: instantSchema,
    }),
  ),
)
const writeEvidenceContinuationOutputSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('applied'), revision: z.number().int().positive() }),
  z.strictObject({ outcome: z.literal('obsolete') }),
])
const promoteEvidenceObservationInputSchema = z.intersection(
  readEvidenceContinuationInputSchema,
  z.strictObject({
    dtoRevision: z.number().int().positive(),
    expectedRevision: z.number().int().positive(),
    validatedAt: instantSchema,
  }),
)
const operationOutcomeSchema = z.strictObject({ outcome: z.enum(['applied', 'obsolete']) })

export const readTrainedSkillsEvidenceOperation = definePlatformPersistenceOperation({
  id: 'read-trained-skills-evidence',
  inputSchema: authoritySchema,
  maximumInputBytes: 2048,
  maximumOutputBytes: platformPersistencePayloadMaximumBytes,
  method: 'readTrainedSkillsEvidence',
  mode: 'read',
  outputSchema: readTrainedSkillsEvidenceOutputSchema,
  revision: 1,
})

export const readAssetEvidenceOperation = definePlatformPersistenceOperation({
  id: 'read-asset-evidence',
  inputSchema: authoritySchema,
  maximumInputBytes: 2048,
  maximumOutputBytes: platformPersistencePayloadMaximumBytes,
  method: 'readAssetEvidence',
  mode: 'read',
  outputSchema: nullableAssetEnvelopeSchema,
  revision: 1,
})

export const readWalletEvidenceOperation = definePlatformPersistenceOperation({
  id: 'read-wallet-evidence',
  inputSchema: boundedEvidenceReadInputSchema,
  maximumInputBytes: 2048,
  maximumOutputBytes: platformPersistencePayloadMaximumBytes,
  method: 'readWalletEvidence',
  mode: 'read',
  outputSchema: readWalletEvidenceOutputSchema,
  revision: 1,
})

export const readMailEvidenceOperation = definePlatformPersistenceOperation({
  id: 'read-mail-evidence',
  inputSchema: boundedEvidenceReadInputSchema,
  maximumInputBytes: 2048,
  maximumOutputBytes: platformPersistencePayloadMaximumBytes,
  method: 'readMailEvidence',
  mode: 'read',
  outputSchema: readMailEvidenceOutputSchema,
  revision: 1,
})

export const writeSkillSnapshotOperation = definePlatformPersistenceOperation({
  id: 'write-skill-snapshot',
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
  maximumInputBytes: platformPersistencePayloadMaximumBytes,
  maximumOutputBytes: 256,
  method: 'writeSkillSnapshot',
  mode: 'write',
  outputSchema: z.strictObject({ outcome: z.enum(['applied', 'obsolete']) }),
  revision: 1,
})

export const materializeCurrentSnapshotOperation = definePlatformPersistenceOperation({
  id: 'materialize-current-snapshot',
  inputSchema: materializeCurrentSnapshotInputSchema,
  maximumInputBytes: platformPersistencePayloadMaximumBytes,
  maximumOutputBytes: 256,
  method: 'materializeCurrentSnapshot',
  mode: 'write',
  outputSchema: operationOutcomeSchema,
  revision: 1,
})

export const readEvidenceContinuationOperation = definePlatformPersistenceOperation({
  id: 'read-evidence-continuation',
  inputSchema: readEvidenceContinuationInputSchema,
  maximumInputBytes: 4096,
  maximumOutputBytes: platformPersistencePayloadMaximumBytes,
  method: 'readEvidenceContinuation',
  mode: 'read',
  outputSchema: readEvidenceContinuationOutputSchema,
  revision: 1,
})

export const readActiveEvidenceContinuationOperation = definePlatformPersistenceOperation({
  id: 'read-active-evidence-continuation',
  inputSchema: readActiveEvidenceContinuationInputSchema,
  maximumInputBytes: 4096,
  maximumOutputBytes: platformPersistencePayloadMaximumBytes,
  method: 'readActiveEvidenceContinuation',
  mode: 'read',
  outputSchema: readActiveEvidenceContinuationOutputSchema,
  revision: 1,
})

export const writeEvidenceContinuationOperation = definePlatformPersistenceOperation({
  id: 'write-evidence-continuation',
  inputSchema: writeEvidenceContinuationInputSchema,
  maximumInputBytes: platformPersistencePayloadMaximumBytes,
  maximumOutputBytes: 512,
  method: 'writeEvidenceContinuation',
  mode: 'write',
  outputSchema: writeEvidenceContinuationOutputSchema,
  revision: 1,
})

export const promoteEvidenceObservationOperation = definePlatformPersistenceOperation({
  id: 'promote-evidence-observation',
  inputSchema: promoteEvidenceObservationInputSchema,
  maximumInputBytes: 4096,
  maximumOutputBytes: 256,
  method: 'promoteEvidenceObservation',
  mode: 'write',
  outputSchema: operationOutcomeSchema,
  revision: 1,
})

const purgeLimitSchema = z.number().int().min(1).max(1000)
const purgeStoreSchema = z.enum([
  'trained-skills',
  'assets',
  'wallet-balance',
  'wallet-journal',
  'wallet-transactions',
  'mail-headers',
  'mail-contents',
  'continuations',
  'staging',
  'promotions',
])
const purgeRetentionInputSchema = z.strictObject({
  cutoff: instantSchema,
  limit: purgeLimitSchema,
  mode: z.literal('retention'),
  store: purgeStoreSchema,
})
const purgeAuthorityInputSchema = z.intersection(
  z.strictObject({
    limit: purgeLimitSchema,
    mode: z.literal('authority'),
    store: purgeStoreSchema,
  }),
  authoritySchema,
)
const purgeAccountInputSchema = z.strictObject({
  limit: purgeLimitSchema,
  mode: z.literal('account'),
  store: purgeStoreSchema,
  targetUserId: z.uuid(),
})
const purgeOrganizationInputSchema = z.strictObject({
  limit: purgeLimitSchema,
  mode: z.literal('organization'),
  organizationVersion: z.number().int().positive(),
  store: purgeStoreSchema,
})
const purgeEvidenceInputSchema = z.union([
  purgeRetentionInputSchema,
  purgeAuthorityInputSchema,
  purgeAccountInputSchema,
  purgeOrganizationInputSchema,
])
const purgeEvidenceOutputSchema = z.strictObject({
  deleted: z.number().int().nonnegative(),
  remaining: z.boolean(),
})
export const purgeEvidenceOperation = definePlatformPersistenceOperation({
  id: 'purge-evidence',
  inputSchema: purgeEvidenceInputSchema,
  maximumInputBytes: 4096,
  maximumOutputBytes: 256,
  method: 'purgeEvidence',
  mode: 'write',
  outputSchema: purgeEvidenceOutputSchema,
  revision: 1,
})

const memberAuditPersistenceOperations = {
  'materialize-current-snapshot': materializeCurrentSnapshotOperation,
  'promote-evidence-observation': promoteEvidenceObservationOperation,
  'purge-evidence': purgeEvidenceOperation,
  'read-active-evidence-continuation': readActiveEvidenceContinuationOperation,
  'read-asset-evidence': readAssetEvidenceOperation,
  'read-evidence-continuation': readEvidenceContinuationOperation,
  'read-mail-evidence': readMailEvidenceOperation,
  'read-trained-skills-evidence': readTrainedSkillsEvidenceOperation,
  'read-wallet-evidence': readWalletEvidenceOperation,
  'write-evidence-continuation': writeEvidenceContinuationOperation,
  'write-skill-snapshot': writeSkillSnapshotOperation,
} as const

export type CurrentSnapshotPersistence = PlatformPersistenceMethodsFor<
  typeof memberAuditPersistenceOperations,
  readonly ['materialize-current-snapshot']
>

export type EvidenceCollectionPersistence = PlatformPersistenceMethodsFor<
  typeof memberAuditPersistenceOperations,
  readonly ['read-active-evidence-continuation']
>

export type EvidenceMaterializationPersistence = PlatformPersistenceMethodsFor<
  typeof memberAuditPersistenceOperations,
  readonly ['write-evidence-continuation', 'promote-evidence-observation']
>

export type EvidenceMaintenancePersistence = PlatformPersistenceMethodsFor<
  typeof memberAuditPersistenceOperations,
  readonly ['purge-evidence']
>
