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
const evidenceScalarSchema = z.union([z.string().max(100_000), z.number(), z.boolean(), z.null()])
const intentionalEvidenceRecordSchema = z
  .record(
    z.string().min(1).max(100),
    z.union([evidenceScalarSchema, z.array(evidenceScalarSchema).max(1_000)]),
  )
  .refine((record) => Object.keys(record).length <= 64)
const assetSnapshotSchema = z.strictObject({
  kind: z.literal('assets'),
  records: z.array(intentionalEvidenceRecordSchema).max(10_000),
})
const walletBalanceSnapshotSchema = z.strictObject({
  kind: z.literal('wallet-balance'),
  balance: z.number(),
})
const authorityShape = {
  organizationVersion: z.number().int().positive(),
  targetUserId: z.uuid(),
  managedMemberLifecycleId: z.uuid(),
  characterId: z.number().int().positive(),
  characterLifecycleId: z.uuid(),
  authorizationGeneration: z.number().int().nonnegative(),
  disclosureVersion: z.number().int().positive(),
  sectionActivationVersion: z.number().int().positive(),
} as const
const boundedRecordListSchema = z.array(intentionalEvidenceRecordSchema).max(500)
const maximumStagedPageRecords = 2_500
const continuationResourceSchema = z.discriminatedUnion('sectionId', [
  z.strictObject({ sectionId: z.literal('assets'), resourceId: z.literal('assets') }),
  z.strictObject({
    sectionId: z.literal('wallet'),
    resourceId: z.enum(['wallet-journal', 'wallet-transactions']),
  }),
  z.strictObject({
    sectionId: z.literal('mail'),
    resourceId: z.enum(['mail-headers', 'mail-details']),
  }),
])
const continuationIdentityShape = {
  operationContractRevision: z.number().int().positive(),
  resourceRevision: z.number().int().positive(),
  organizationVersion: z.number().int().positive(),
  targetUserId: z.uuid(),
  managedMemberLifecycleId: z.uuid(),
  characterId: z.number().int().positive(),
  characterLifecycleId: z.uuid(),
  authorizationGeneration: z.number().int().nonnegative(),
  disclosureVersion: z.number().int().positive(),
  sectionActivationVersion: z.number().int().positive(),
  observationId: z.uuid(),
} as const
const continuationIdentitySchema = z.strictObject(continuationIdentityShape)
const continuationCheckpointSchema = z
  .record(z.string().min(1).max(100), z.json())
  .refine((checkpoint) => Object.keys(checkpoint).length <= 64)
const assetStagedRecordSchema = z.strictObject({
  recordKind: z.literal('asset'),
  sourceId: z.string().min(1).max(200),
  sourceTimestamp: z.nullable(instantSchema),
  evidence: intentionalEvidenceRecordSchema,
  validatedAt: instantSchema,
})
const walletJournalStagedRecordSchema = z.strictObject({
  recordKind: z.literal('wallet-journal'),
  sourceId: z.string().min(1).max(200),
  sourceTimestamp: z.nullable(instantSchema),
  evidence: intentionalEvidenceRecordSchema,
  validatedAt: instantSchema,
})
const walletTransactionStagedRecordSchema = z.strictObject({
  recordKind: z.literal('wallet-transaction'),
  sourceId: z.string().min(1).max(200),
  sourceTimestamp: z.nullable(instantSchema),
  evidence: intentionalEvidenceRecordSchema,
  validatedAt: instantSchema,
})
const mailHeaderStagedRecordSchema = z.strictObject({
  recordKind: z.literal('mail-header'),
  sourceId: z.string().min(1).max(200),
  sourceTimestamp: z.nullable(instantSchema),
  evidence: intentionalEvidenceRecordSchema,
  validatedAt: instantSchema,
})
const mailContentStagedRecordSchema = z.strictObject({
  recordKind: z.literal('mail-content'),
  sourceId: z.string().min(1).max(200),
  sourceTimestamp: z.nullable(instantSchema),
  evidence: intentionalEvidenceRecordSchema,
  validatedAt: instantSchema,
})
const authoritySchema = z.strictObject(authorityShape)
const trainedSkillsEnvelopeSchema = z.strictObject({
  observationId: z.uuid(),
  dtoRevision: z.number().int().positive(),
  validatedAt: instantSchema,
  snapshot: trainedSkillsSchema,
})
const skillQueueEnvelopeSchema = z.strictObject({
  observationId: z.uuid(),
  dtoRevision: z.number().int().positive(),
  validatedAt: instantSchema,
  snapshot: skillQueueSchema,
})
const assetEnvelopeSchema = z.strictObject({
  observationId: z.uuid(),
  dtoRevision: z.number().int().positive(),
  validatedAt: instantSchema,
  snapshot: assetSnapshotSchema,
})
const nullableAssetEnvelopeSchema = z.nullable(assetEnvelopeSchema)
const walletBalanceEnvelopeSchema = z.strictObject({
  observationId: z.uuid(),
  dtoRevision: z.number().int().positive(),
  validatedAt: instantSchema,
  snapshot: walletBalanceSnapshotSchema,
})
const readSkillEvidenceOutputSchema = z.strictObject({
  trainedSkills: z.nullable(trainedSkillsEnvelopeSchema),
  skillQueue: z.nullable(skillQueueEnvelopeSchema),
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
  headers: boundedRecordListSchema,
  contents: boundedRecordListSchema,
})
const materializeCurrentSnapshotInputSchema = z.discriminatedUnion('resourceId', [
  z.strictObject({
    resourceId: z.literal('trained-skills'),
    organizationVersion: z.number().int().positive(),
    targetUserId: z.uuid(),
    managedMemberLifecycleId: z.uuid(),
    characterId: z.number().int().positive(),
    characterLifecycleId: z.uuid(),
    authorizationGeneration: z.number().int().nonnegative(),
    disclosureVersion: z.number().int().positive(),
    sectionActivationVersion: z.number().int().positive(),
    observationId: z.uuid(),
    dtoRevision: z.number().int().positive(),
    validatedAt: instantSchema,
    snapshot: trainedSkillsSchema,
  }),
  z.strictObject({
    resourceId: z.literal('wallet-balance'),
    organizationVersion: z.number().int().positive(),
    targetUserId: z.uuid(),
    managedMemberLifecycleId: z.uuid(),
    characterId: z.number().int().positive(),
    characterLifecycleId: z.uuid(),
    authorizationGeneration: z.number().int().nonnegative(),
    disclosureVersion: z.number().int().positive(),
    sectionActivationVersion: z.number().int().positive(),
    observationId: z.uuid(),
    dtoRevision: z.number().int().positive(),
    validatedAt: instantSchema,
    snapshot: walletBalanceSnapshotSchema,
  }),
])
const readEvidenceContinuationInputSchema = z.intersection(
  continuationResourceSchema,
  continuationIdentitySchema,
)
const readEvidenceContinuationOutputSchema = z
  .strictObject({
    revision: z.number().int().nonnegative(),
    checkpoint: continuationCheckpointSchema,
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
    observationId: z.uuid(),
    revision: z.number().int().nonnegative(),
    checkpoint: continuationCheckpointSchema,
  })
  .nullable()
const stagedRecordsByResourceSchema = z.discriminatedUnion('resourceId', [
  z.strictObject({
    sectionId: z.literal('assets'),
    resourceId: z.literal('assets'),
    records: z.array(assetStagedRecordSchema).max(maximumStagedPageRecords),
  }),
  z.strictObject({
    sectionId: z.literal('wallet'),
    resourceId: z.literal('wallet-journal'),
    records: z.array(walletJournalStagedRecordSchema).max(maximumStagedPageRecords),
  }),
  z.strictObject({
    sectionId: z.literal('wallet'),
    resourceId: z.literal('wallet-transactions'),
    records: z.array(walletTransactionStagedRecordSchema).max(maximumStagedPageRecords),
  }),
  z.strictObject({
    sectionId: z.literal('mail'),
    resourceId: z.literal('mail-headers'),
    records: z.array(mailHeaderStagedRecordSchema).max(500),
  }),
  z.strictObject({
    sectionId: z.literal('mail'),
    resourceId: z.literal('mail-details'),
    records: z.array(mailContentStagedRecordSchema).max(500),
  }),
])
const writeEvidenceContinuationInputSchema = z.intersection(
  continuationIdentitySchema,
  z.intersection(
    stagedRecordsByResourceSchema,
    z.strictObject({
      expectedRevision: z.number().int().nonnegative(),
      checkpoint: continuationCheckpointSchema,
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
    expectedRevision: z.number().int().positive(),
    dtoRevision: z.number().int().positive(),
    validatedAt: instantSchema,
  }),
)
const operationOutcomeSchema = z.strictObject({ outcome: z.enum(['applied', 'obsolete']) })

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
  outputSchema: operationOutcomeSchema,
  maximumInputBytes: platformPersistencePayloadMaximumBytes,
  maximumOutputBytes: 256,
})

export const readSkillEvidenceOperation = definePlatformPersistenceOperation({
  id: 'read-skill-evidence',
  method: 'readSkillEvidence',
  revision: 1,
  mode: 'read',
  inputSchema: authoritySchema,
  outputSchema: readSkillEvidenceOutputSchema,
  maximumInputBytes: 2_048,
  maximumOutputBytes: platformPersistencePayloadMaximumBytes,
})

export const readTrainedSkillsEvidenceOperation = definePlatformPersistenceOperation({
  id: 'read-trained-skills-evidence',
  method: 'readTrainedSkillsEvidence',
  revision: 1,
  mode: 'read',
  inputSchema: authoritySchema,
  outputSchema: readTrainedSkillsEvidenceOutputSchema,
  maximumInputBytes: 2_048,
  maximumOutputBytes: platformPersistencePayloadMaximumBytes,
})

export const readAssetEvidenceOperation = definePlatformPersistenceOperation({
  id: 'read-asset-evidence',
  method: 'readAssetEvidence',
  revision: 1,
  mode: 'read',
  inputSchema: authoritySchema,
  outputSchema: nullableAssetEnvelopeSchema,
  maximumInputBytes: 2_048,
  maximumOutputBytes: platformPersistencePayloadMaximumBytes,
})

export const readWalletEvidenceOperation = definePlatformPersistenceOperation({
  id: 'read-wallet-evidence',
  method: 'readWalletEvidence',
  revision: 1,
  mode: 'read',
  inputSchema: boundedEvidenceReadInputSchema,
  outputSchema: readWalletEvidenceOutputSchema,
  maximumInputBytes: 2_048,
  maximumOutputBytes: platformPersistencePayloadMaximumBytes,
})

export const readMailEvidenceOperation = definePlatformPersistenceOperation({
  id: 'read-mail-evidence',
  method: 'readMailEvidence',
  revision: 1,
  mode: 'read',
  inputSchema: boundedEvidenceReadInputSchema,
  outputSchema: readMailEvidenceOutputSchema,
  maximumInputBytes: 2_048,
  maximumOutputBytes: platformPersistencePayloadMaximumBytes,
})

export const materializeCurrentSnapshotOperation = definePlatformPersistenceOperation({
  id: 'materialize-current-snapshot',
  method: 'materializeCurrentSnapshot',
  revision: 1,
  mode: 'write',
  inputSchema: materializeCurrentSnapshotInputSchema,
  outputSchema: operationOutcomeSchema,
  maximumInputBytes: platformPersistencePayloadMaximumBytes,
  maximumOutputBytes: 256,
})

export const readEvidenceContinuationOperation = definePlatformPersistenceOperation({
  id: 'read-evidence-continuation',
  method: 'readEvidenceContinuation',
  revision: 1,
  mode: 'read',
  inputSchema: readEvidenceContinuationInputSchema,
  outputSchema: readEvidenceContinuationOutputSchema,
  maximumInputBytes: 4_096,
  maximumOutputBytes: platformPersistencePayloadMaximumBytes,
})

export const readActiveEvidenceContinuationOperation = definePlatformPersistenceOperation({
  id: 'read-active-evidence-continuation',
  method: 'readActiveEvidenceContinuation',
  revision: 1,
  mode: 'read',
  inputSchema: readActiveEvidenceContinuationInputSchema,
  outputSchema: readActiveEvidenceContinuationOutputSchema,
  maximumInputBytes: 4_096,
  maximumOutputBytes: platformPersistencePayloadMaximumBytes,
})

export const writeEvidenceContinuationOperation = definePlatformPersistenceOperation({
  id: 'write-evidence-continuation',
  method: 'writeEvidenceContinuation',
  revision: 1,
  mode: 'write',
  inputSchema: writeEvidenceContinuationInputSchema,
  outputSchema: writeEvidenceContinuationOutputSchema,
  maximumInputBytes: platformPersistencePayloadMaximumBytes,
  maximumOutputBytes: 512,
})

export const promoteEvidenceObservationOperation = definePlatformPersistenceOperation({
  id: 'promote-evidence-observation',
  method: 'promoteEvidenceObservation',
  revision: 1,
  mode: 'write',
  inputSchema: promoteEvidenceObservationInputSchema,
  outputSchema: operationOutcomeSchema,
  maximumInputBytes: 4_096,
  maximumOutputBytes: 256,
})

const purgeLimitSchema = z.number().int().min(1).max(1_000)
const purgeStoreSchema = z.enum([
  'legacy-skills',
  'trained-skills',
  'skill-queue',
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
  mode: z.literal('retention'),
  store: purgeStoreSchema,
  cutoff: instantSchema,
  limit: purgeLimitSchema,
})
const purgeAuthorityInputSchema = z.intersection(
  z.strictObject({
    mode: z.literal('authority'),
    store: purgeStoreSchema,
    limit: purgeLimitSchema,
  }),
  authoritySchema,
)
const purgeAccountInputSchema = z.strictObject({
  mode: z.literal('account'),
  store: purgeStoreSchema,
  targetUserId: z.uuid(),
  limit: purgeLimitSchema,
})
const purgeOrganizationInputSchema = z.strictObject({
  mode: z.literal('organization'),
  store: purgeStoreSchema,
  organizationVersion: z.number().int().positive(),
  limit: purgeLimitSchema,
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
  method: 'purgeEvidence',
  revision: 1,
  mode: 'write',
  inputSchema: purgeEvidenceInputSchema,
  outputSchema: purgeEvidenceOutputSchema,
  maximumInputBytes: 4_096,
  maximumOutputBytes: 256,
})

const memberAuditPersistenceOperations = {
  'write-skill-snapshot': writeSkillSnapshotOperation,
  'read-skill-evidence': readSkillEvidenceOperation,
  'read-trained-skills-evidence': readTrainedSkillsEvidenceOperation,
  'read-asset-evidence': readAssetEvidenceOperation,
  'read-wallet-evidence': readWalletEvidenceOperation,
  'read-mail-evidence': readMailEvidenceOperation,
  'materialize-current-snapshot': materializeCurrentSnapshotOperation,
  'read-evidence-continuation': readEvidenceContinuationOperation,
  'read-active-evidence-continuation': readActiveEvidenceContinuationOperation,
  'write-evidence-continuation': writeEvidenceContinuationOperation,
  'promote-evidence-observation': promoteEvidenceObservationOperation,
  'purge-evidence': purgeEvidenceOperation,
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
