import {
  projectWalletJournalEntry,
  projectWalletTransactions,
  safeWalletJournalContextTypes,
  type WalletJournalContextType,
} from '@eve-space/core-eve-projections/wallet'
import { operationRegistry } from '@evespace/esi-client/operations'
import type { GetCharactersCharacterIdWalletJournalResponse } from '@evespace/esi-client/types'
import { z } from 'zod'
import {
  createCharacterEsiRead,
  toEsiReadResultMetadata,
  type EsiReadResultMetadata,
} from '../esi-gateway/feature-execution.js'
import { loadFinanceLocationNames } from './finance-location-names.js'
import {
  assertFinancePositiveSafeInteger,
  financePageCacheSchema,
  resolveFinanceTotalPages,
} from './finance-pagination.js'
import { loadFinanceTypeNames } from './finance-type-names.js'

interface WalletBalanceRepresentationInput {
  characterId: number
  subjectLifecycleId: string
}

const walletBalanceRead = createCharacterEsiRead({
  cacheSchema: operationRegistry.GetCharactersCharacterIdWallet.responseSchema,
  descriptor: operationRegistry.GetCharactersCharacterIdWallet.transport,
  encodeRequest: (input: WalletBalanceRepresentationInput) => ({
    path: { character_id: input.characterId },
  }),
  map: (response): number => response.data,
  name: 'wallet-balance-core',
  operation: 'wallet-balance',
})

export const walletScope = walletBalanceRead.requiredScope

interface WalletBalanceData {
  balance: number
}

type WalletBalanceResult = WalletBalanceData & EsiReadResultMetadata

interface WalletJournalRepresentationInput {
  characterId: number
  page: number
  subjectLifecycleId: string
}

type EsiWalletJournalEntry = GetCharactersCharacterIdWalletJournalResponse[number]

interface WalletJournalData {
  entries: Array<{
    journalId: number
    date: string
    amount: number | null
    balance: number | null
    referenceType: EsiWalletJournalEntry['ref_type']
    description: string
    reason: string | null
    taxAmount: number | null
    context: { id: number; type: WalletJournalContextType } | null
  }>
  page: number
  totalPages: number
}

type WalletJournalResult = WalletJournalData & EsiReadResultMetadata

const walletJournalCacheSchema = z
  .object({
    entries: z.array(
      z.object({
        amount: z.number().nullable(),
        balance: z.number().nullable(),
        context: z
          .object({ id: z.number(), type: z.enum(safeWalletJournalContextTypes) })
          .nullable(),
        date: z.string(),
        description: z.string(),
        journalId: z.number(),
        reason: z.string().nullable(),
        referenceType: z.string(),
        taxAmount: z.number().nullable(),
      }),
    ),
    page: financePageCacheSchema,
    totalPages: financePageCacheSchema,
  })
  .transform((data, context): WalletJournalData => {
    const references =
      operationRegistry.GetCharactersCharacterIdWalletJournal.responseSchema.safeParse(
        data.entries.map((entry) => ({
          date: '2000-01-01T00:00:00Z',
          description: '',
          id: 1,
          ref_type: entry.referenceType,
        })),
      )
    if (!references.success) {
      context.addIssue({ code: 'custom', message: 'Invalid wallet journal reference type' })
      return z.NEVER
    }
    return {
      ...data,
      entries: data.entries.map((entry, index) => ({
        ...entry,
        referenceType: references.data[index]!.ref_type,
      })),
    }
  })

const walletJournalRead = createCharacterEsiRead({
  cacheSchema: walletJournalCacheSchema,
  cacheSchemaForInput: (input: WalletJournalRepresentationInput) =>
    walletJournalCacheSchema.refine(({ page }) => page === input.page),
  descriptor: operationRegistry.GetCharactersCharacterIdWalletJournal.transport,
  encodeRequest: (input: WalletJournalRepresentationInput) => ({
    path: { character_id: input.characterId },
    query: { page: input.page },
  }),
  map: (response, input): WalletJournalData => ({
    entries: response.data.map(projectWalletJournalEntry),
    page: input.page,
    totalPages: resolveFinanceTotalPages(response.meta.pagination?.pages, input.page),
  }),
  name: 'wallet-journal-core',
  operation: 'wallet-journal',
})

interface WalletTransactionsRepresentationInput {
  characterId: number
  fromId: number | null
  subjectLifecycleId: string
}

interface WalletTransactionsData {
  transactions: Array<{
    transactionId: number
    journalRefId: number
    date: string
    typeId: number
    typeName: string
    quantity: number
    unitPrice: number
    totalPrice: number
    isBuy: boolean
    locationId: number
    locationName: string | null
  }>
  fromId: number | null
  nextFromId: number | null
}

type WalletTransactionsResult = WalletTransactionsData & EsiReadResultMetadata

const walletTransactionPageSize = 2500

const walletTransactionsCacheSchema = z.object({
  fromId: financePageCacheSchema.nullable(),
  nextFromId: financePageCacheSchema.nullable(),
  transactions: z.array(
    z.object({
      transactionId: z.number(),
      journalRefId: z.number(),
      date: z.string(),
      typeId: z.number(),
      typeName: z.string(),
      quantity: z.number(),
      unitPrice: z.number(),
      totalPrice: z.number(),
      isBuy: z.boolean(),
      locationId: z.number(),
      locationName: z.string().nullable(),
    }),
  ),
})

const walletTransactionsRead = createCharacterEsiRead({
  cacheSchema: walletTransactionsCacheSchema,
  cacheSchemaForInput: (input: WalletTransactionsRepresentationInput) =>
    walletTransactionsCacheSchema.refine(({ fromId }) => fromId === input.fromId),
  descriptor: operationRegistry.GetCharactersCharacterIdWalletTransactions.transport,
  encodeRequest: (input: WalletTransactionsRepresentationInput) => ({
    path: { character_id: input.characterId },
    ...(input.fromId !== null && { query: { from_id: input.fromId } }),
  }),
  map: async (response, input): Promise<WalletTransactionsData> => {
    const personalTransactions = response.data.filter((transaction) => transaction.is_personal)
    const [namesByType, namesByLocation] = await Promise.all([
      loadFinanceTypeNames(personalTransactions.map((transaction) => transaction.type_id)),
      loadFinanceLocationNames(personalTransactions.map((transaction) => transaction.location_id)),
    ])

    return {
      transactions: projectWalletTransactions(response.data, namesByType, namesByLocation),
      fromId: input.fromId,
      nextFromId:
        response.data.length < walletTransactionPageSize
          ? null
          : Math.min(...response.data.map((transaction) => transaction.transaction_id)),
    }
  },
  name: 'wallet-transactions-core',
  operation: 'wallet-transactions',
})

export async function getWalletBalance(
  characterId: number,
  subjectLifecycleId: string,
): Promise<WalletBalanceResult> {
  const result = await walletBalanceRead.execute({ characterId, subjectLifecycleId })
  return { balance: result.data, ...toEsiReadResultMetadata(result) }
}

export async function getWalletJournal(
  characterId: number,
  page: number,
  subjectLifecycleId: string,
): Promise<WalletJournalResult> {
  assertFinancePositiveSafeInteger(page, 'Wallet journal page')
  const result = await walletJournalRead.execute({ characterId, page, subjectLifecycleId })
  return { ...result.data, ...toEsiReadResultMetadata(result) }
}

export async function getWalletTransactions(
  characterId: number,
  fromId: number | null = null,
  subjectLifecycleId: string,
): Promise<WalletTransactionsResult> {
  if (fromId !== null) {
    assertFinancePositiveSafeInteger(fromId, 'Wallet transaction continuation')
  }
  const result = await walletTransactionsRead.execute({ characterId, fromId, subjectLifecycleId })
  return { ...result.data, ...toEsiReadResultMetadata(result) }
}
