import { operationRegistry } from '@evespace/esi-client/operations'
import type { GetCharactersCharacterIdWalletJournalResponse } from '@evespace/esi-client/types'
import {
  createCharacterEsiRead,
  toEsiReadResultMetadata,
  type EsiReadResultMetadata,
} from '../esi-gateway/feature-execution.js'
import { isPositiveSafeInteger } from '../type-guards.js'
import { financeLocationName, loadFinanceLocationNames } from './finance-location-names.js'
import { assertFinancePositiveSafeInteger, resolveFinanceTotalPages } from './finance-pagination.js'
import { financeTypeName, loadFinanceTypeNames } from './finance-type-names.js'

interface WalletBalanceRepresentationInput {
  characterId: number
  subjectLifecycleId: string
}

const walletBalanceRead = createCharacterEsiRead({
  operation: 'wallet-balance',
  name: 'wallet-balance-core',
  descriptor: operationRegistry.GetCharactersCharacterIdWallet.transport,
  encodeRequest: (input: WalletBalanceRepresentationInput) => ({
    path: { character_id: input.characterId },
  }),
  map: (response): number => response.data,
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

const safeJournalContextTypes = [
  'structure_id',
  'station_id',
  'market_transaction_id',
  'eve_system',
  'industry_job_id',
  'contract_id',
  'planet_id',
  'system_id',
  'type_id',
] as const

type WalletJournalContextType = (typeof safeJournalContextTypes)[number]
const safeJournalContextTypeSet = new Set<string>(safeJournalContextTypes)
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

const walletJournalRead = createCharacterEsiRead({
  operation: 'wallet-journal',
  name: 'wallet-journal-core',
  descriptor: operationRegistry.GetCharactersCharacterIdWalletJournal.transport,
  encodeRequest: (input: WalletJournalRepresentationInput) => ({
    path: { character_id: input.characterId },
    query: { page: input.page },
  }),
  map: (response, input): WalletJournalData => ({
    entries: response.data.map((entry) => ({
      journalId: entry.id,
      date: entry.date,
      amount: entry.amount ?? null,
      balance: entry.balance ?? null,
      referenceType: entry.ref_type,
      description: entry.description,
      reason: entry.reason ?? null,
      taxAmount: entry.tax ?? null,
      context: walletJournalContext(entry),
    })),
    page: input.page,
    totalPages: resolveFinanceTotalPages(response.meta.pagination?.pages, input.page),
  }),
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

const walletTransactionPageSize = 2_500

const walletTransactionsRead = createCharacterEsiRead({
  operation: 'wallet-transactions',
  name: 'wallet-transactions-core',
  descriptor: operationRegistry.GetCharactersCharacterIdWalletTransactions.transport,
  encodeRequest: (input: WalletTransactionsRepresentationInput) => ({
    path: { character_id: input.characterId },
    ...(input.fromId === null ? {} : { query: { from_id: input.fromId } }),
  }),
  map: async (response, input): Promise<WalletTransactionsData> => {
    const personalTransactions = response.data.filter((transaction) => transaction.is_personal)
    const [namesByType, namesByLocation] = await Promise.all([
      loadFinanceTypeNames(personalTransactions.map((transaction) => transaction.type_id)),
      loadFinanceLocationNames(personalTransactions.map((transaction) => transaction.location_id)),
    ])

    return {
      transactions: personalTransactions
        .map((transaction) => ({
          transactionId: transaction.transaction_id,
          journalRefId: transaction.journal_ref_id,
          date: transaction.date,
          typeId: transaction.type_id,
          typeName: financeTypeName(transaction.type_id, namesByType),
          quantity: transaction.quantity,
          unitPrice: transaction.unit_price,
          totalPrice: transaction.quantity * transaction.unit_price,
          isBuy: transaction.is_buy,
          locationId: transaction.location_id,
          locationName: financeLocationName(transaction.location_id, namesByLocation),
        }))
        .toSorted(
          (left, right) =>
            Date.parse(right.date) - Date.parse(left.date) ||
            right.transactionId - left.transactionId,
        ),
      fromId: input.fromId,
      nextFromId:
        response.data.length < walletTransactionPageSize
          ? null
          : Math.min(...response.data.map((transaction) => transaction.transaction_id)),
    }
  },
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
  if (fromId !== null) assertFinancePositiveSafeInteger(fromId, 'Wallet transaction continuation')
  const result = await walletTransactionsRead.execute({ characterId, fromId, subjectLifecycleId })
  return { ...result.data, ...toEsiReadResultMetadata(result) }
}

function walletJournalContext(entry: EsiWalletJournalEntry) {
  if (
    entry.context_id === undefined ||
    entry.context_id_type === undefined ||
    !isPositiveSafeInteger(entry.context_id) ||
    !isSafeJournalContextType(entry.context_id_type)
  )
    return null
  return { id: entry.context_id, type: entry.context_id_type }
}

function isSafeJournalContextType(value: string): value is WalletJournalContextType {
  return safeJournalContextTypeSet.has(value)
}
