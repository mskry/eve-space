import {
  projectWalletJournalEntry,
  projectWalletTransactions,
} from '@eve-space/core-eve-projections/wallet'
import type {
  PlatformBoundedCollectionResourceImplementation,
  PlatformCharacterResourceSubject,
  PlatformResourceMaterializationContext,
  PlatformSingleRequestResourceImplementation,
} from '@eve-space/platform-module-contract/resources'
import type { PlatformCoreEsiOperationProtocol } from '@eve-space/platform-module-server'
import { z } from 'zod'
import {
  materializeEvidenceObservation,
  startEvidenceCollection,
  type EvidenceCollectionContext,
  type EvidenceObservation,
} from './evidence-collection.js'
import { maintainEvidence } from './evidence-maintenance.js'
import { createObservationId } from './observation-identity.js'
import { requireEsiPageCount } from './page-count.js'
import type {
  CurrentSnapshotPersistence,
  EvidenceCollectionPersistence,
  EvidenceMaintenancePersistence,
  EvidenceMaterializationPersistence,
} from './persistence.js'

const financePageSize = 2_500
const projectionBatchSize = 500
const maximumJournalPages = 1_000
const journalEntrySchema = z.object({
  id: z.number().int().positive(),
  date: z.iso.datetime({ offset: true }),
  amount: z.number().optional(),
  balance: z.number().optional(),
  ref_type: z.string().min(1).max(100),
  description: z.string().max(100_000),
  reason: z.string().max(100_000).optional(),
  tax: z.number().optional(),
  context_id: z.number().int().positive().optional(),
  context_id_type: z.string().max(100).optional(),
})
const journalPageSchema = z.array(journalEntrySchema).max(financePageSize)
const transactionSchema = z.object({
  transaction_id: z.number().int().positive(),
  journal_ref_id: z.number().int().positive(),
  date: z.iso.datetime({ offset: true }),
  type_id: z.number().int().positive(),
  quantity: z.number().int().positive(),
  unit_price: z.number().nonnegative(),
  is_buy: z.boolean(),
  is_personal: z.boolean(),
  location_id: z.number().int().positive(),
})
const transactionPageSchema = z.array(transactionSchema).max(financePageSize)
const journalCheckpointSchema = z.object({
  page: z.number().int().min(1).max(maximumJournalPages).default(1),
})
const transactionCheckpointSchema = z.object({
  fromId: z.number().int().positive().nullable().default(null),
})

type WalletBalanceData = { readonly kind: 'wallet-balance'; readonly balance: number }
type WalletJournalObservation = Extract<EvidenceObservation, { resourceId: 'wallet-journal' }>
type WalletTransactionObservation = Extract<
  EvidenceObservation,
  { resourceId: 'wallet-transactions' }
>
type WalletTransactionProducts = readonly ['published-type-details', 'static-location-labels']
type WalletTransactionProtocol = PlatformCoreEsiOperationProtocol<'wallet-transactions'>
type WalletTransactionCollectionContext = EvidenceCollectionContext<
  WalletTransactionProtocol,
  WalletTransactionProducts
>
type WalletBalanceContext = PlatformResourceMaterializationContext<
  WalletBalanceData,
  PlatformCharacterResourceSubject,
  CurrentSnapshotPersistence
>

export const walletBalanceResource: PlatformSingleRequestResourceImplementation<
  'wallet-balance',
  PlatformCoreEsiOperationProtocol<'wallet-balance'>,
  WalletBalanceData,
  string,
  unknown,
  PlatformCharacterResourceSubject,
  readonly [],
  CurrentSnapshotPersistence,
  EvidenceMaintenancePersistence
> = {
  mode: 'single-request',
  operation: 'wallet-balance',
  request(subject) {
    return { path: { character_id: subject.characterId } }
  },
  map({ data }) {
    return { kind: 'wallet-balance', balance: z.number().parse(data) }
  },
  async materialize(context) {
    return materializeWalletBalance(context)
  },
  maintain(context) {
    return maintainEvidence('wallet-balance', context, false)
  },
}

export const walletJournalResource: PlatformBoundedCollectionResourceImplementation<
  'wallet-journal',
  PlatformCoreEsiOperationProtocol<'wallet-journal'>,
  WalletJournalObservation,
  string,
  unknown,
  PlatformCharacterResourceSubject,
  readonly [],
  EvidenceCollectionPersistence,
  EvidenceMaterializationPersistence,
  EvidenceMaintenancePersistence
> = {
  mode: 'bounded-collection',
  operation: 'wallet-journal',
  async collect(context) {
    const collection = await startEvidenceCollection(
      { sectionId: 'wallet', resourceId: 'wallet-journal' },
      context,
    )
    const checkpoint = journalCheckpointSchema.parse(collection.checkpoint)
    const result = await context.operations['wallet-journal']({
      path: { character_id: context.subject.characterId },
      query: { page: checkpoint.page },
    })
    const page = journalPageSchema.parse(result.data)
    const totalPages = requireEsiPageCount(
      result.pagination,
      checkpoint.page,
      maximumJournalPages,
      'Wallet journal',
    )
    const complete = checkpoint.page === totalPages
    return {
      complete,
      data: {
        sectionId: 'wallet',
        resourceId: 'wallet-journal',
        observationId: collection.observationId,
        expectedRevision: collection.expectedRevision,
        checkpoint: complete
          ? { complete: true, page: checkpoint.page }
          : { complete: false, page: checkpoint.page + 1 },
        records: page.map((entry) => {
          const projected = projectWalletJournalEntry(entry)
          return {
            recordKind: 'wallet-journal' as const,
            sourceId: String(projected.journalId),
            sourceTimestamp: projected.date,
            evidence: {
              journalId: projected.journalId,
              date: projected.date,
              amount: projected.amount,
              balance: projected.balance,
              referenceType: projected.referenceType,
              description: projected.description,
              reason: projected.reason,
              taxAmount: projected.taxAmount,
              contextId: projected.context?.id ?? null,
              contextType: projected.context?.type ?? null,
            },
            validatedAt: result.validatedAt,
          }
        }),
      },
    }
  },
  materialize(context) {
    return materializeEvidenceObservation(context)
  },
  maintain(context) {
    return maintainEvidence('wallet-journal', context, false)
  },
}

export const walletTransactionsResource: PlatformBoundedCollectionResourceImplementation<
  'wallet-transactions',
  WalletTransactionProtocol,
  WalletTransactionObservation,
  string,
  unknown,
  PlatformCharacterResourceSubject,
  WalletTransactionProducts,
  EvidenceCollectionPersistence,
  EvidenceMaterializationPersistence,
  EvidenceMaintenancePersistence
> = {
  mode: 'bounded-collection',
  operation: 'wallet-transactions',
  async collect(context) {
    const collection = await startEvidenceCollection(
      { sectionId: 'wallet', resourceId: 'wallet-transactions' },
      context,
    )
    const checkpoint = transactionCheckpointSchema.parse(collection.checkpoint)
    const result = await context.operations['wallet-transactions']({
      path: { character_id: context.subject.characterId },
      ...(checkpoint.fromId === null ? {} : { query: { from_id: checkpoint.fromId } }),
    })
    const page = transactionPageSchema.parse(result.data)
    const projected = await projectTransactionPage(page, context)
    const complete = page.length < financePageSize
    const nextFromId = complete ? null : Math.min(...page.map((entry) => entry.transaction_id))
    if (!complete && nextFromId === checkpoint.fromId)
      throw new Error('Wallet transaction continuation did not advance')
    return {
      complete,
      data: {
        sectionId: 'wallet',
        resourceId: 'wallet-transactions',
        observationId: collection.observationId,
        expectedRevision: collection.expectedRevision,
        checkpoint: complete
          ? { complete: true, fromId: checkpoint.fromId }
          : { complete: false, fromId: nextFromId },
        records: projected.map((entry) => ({
          recordKind: 'wallet-transaction' as const,
          sourceId: String(entry.transactionId),
          sourceTimestamp: entry.date,
          evidence: { ...entry },
          validatedAt: result.validatedAt,
        })),
      },
    }
  },
  materialize(context) {
    return materializeEvidenceObservation(context)
  },
  maintain(context) {
    return maintainEvidence('wallet-transactions', context, false)
  },
}

async function projectTransactionPage(
  source: readonly z.infer<typeof transactionSchema>[],
  context: WalletTransactionCollectionContext,
) {
  const batches = Array.from(
    { length: Math.ceil(source.length / projectionBatchSize) },
    (_, index) => source.slice(index * projectionBatchSize, (index + 1) * projectionBatchSize),
  )
  return (
    await Promise.all(
      batches.map(async (batch) => {
        const typeIds = unique(
          batch.filter((entry) => entry.is_personal).map((entry) => entry.type_id),
        )
        const locationIds = unique(
          batch.filter((entry) => entry.is_personal).map((entry) => entry.location_id),
        )
        const [types, locations] = await Promise.all([
          context.capabilities.coreData.publishedTypeDetails({ typeIds }),
          context.capabilities.coreData.staticLocationLabels({ locationIds }),
        ])
        return projectWalletTransactions(
          batch,
          new Map(types.rows.map((type) => [type.typeId, type.typeName])),
          new Map(locations.rows.map((location) => [location.locationId, location.name])),
        )
      }),
    )
  ).flat()
}

async function materializeWalletBalance(
  context: WalletBalanceContext,
): Promise<void | { readonly outcome: 'obsolete' }> {
  const authority = context.managedAuthority
  if (
    context.organizationVersion !== authority?.organizationVersion ||
    context.authorizationGeneration === null ||
    authority.sectionId !== 'wallet'
  )
    return { outcome: 'obsolete' }
  const result = await context.capabilities.persistence.materializeCurrentSnapshot({
    resourceId: 'wallet-balance',
    organizationVersion: authority.organizationVersion,
    targetUserId: authority.targetUserId,
    managedMemberLifecycleId: authority.managedMemberLifecycleId,
    characterId: context.subject.characterId,
    characterLifecycleId: context.subject.lifecycleId,
    authorizationGeneration: context.authorizationGeneration,
    disclosureVersion: authority.disclosureVersion,
    sectionActivationVersion: authority.sectionActivationVersion,
    observationId: createObservationId(
      'wallet-balance',
      context.subject.lifecycleId,
      context.validatedAt,
    ),
    dtoRevision: 1,
    validatedAt: context.validatedAt,
    snapshot: context.data,
  })
  return result.outcome === 'obsolete' ? { outcome: 'obsolete' } : undefined
}

function unique(values: readonly number[]) {
  return [...new Set(values)]
}
