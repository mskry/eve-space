import { createWalletClient } from '@evespace/esi-client/domains/wallet'
import type { GetCharactersCharacterIdWalletJournalOutput } from '@evespace/esi-client/schemas'
import { EsiQuotaError } from '../esi-resilience/cooldowns.js'
import { getCharacterEsiScope } from '../esi-resilience/catalog.js'
import { toEsiResultMetadata } from '../esi-resilience/public-metadata.js'
import { getEsiResilienceLayer } from '../esi-resilience/resilience.js'
import { createEsiTransport } from '../esi-resilience/transport.js'
import type { EsiResultMetadata } from '../esi-resilience/types.js'
import { financeLocationName, loadFinanceLocationNames } from './finance-location-names.js'
import { financeTypeName, loadFinanceTypeNames } from './finance-type-names.js'

export const walletScope = getCharacterEsiScope('wallet-balance')

interface WalletBalanceData {
  balance: number
}

export type WalletBalanceResult = WalletBalanceData & EsiResultMetadata

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

export type WalletTransactionsResult = WalletTransactionsData & EsiResultMetadata

const walletTransactionPageSize = 2_500

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
type EsiWalletJournalEntry = GetCharactersCharacterIdWalletJournalOutput[number]

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

export type WalletJournalResult = WalletJournalData & EsiResultMetadata

export class WalletQuotaError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('ESI wallet quota is temporarily exhausted')
  }
}

async function loadWalletBalance(characterId: number) {
  return getEsiResilienceLayer().getCharacter({
    operation: 'wallet-balance',
    inputs: { characterId },
    load: (authority, revalidation) =>
      createWalletClient({
        fetch: createEsiTransport('wallet-balance', authority.principal),
        token: authority.accessToken,
      })
        .withMetadata()
        .getCharacterBalance(characterId, revalidation),
  })
}

async function loadWalletJournal(characterId: number, page: number) {
  return getEsiResilienceLayer().getCharacter<WalletJournalData>({
    operation: 'wallet-journal',
    inputs: { characterId, page },
    load: async (authority, revalidation) => {
      const response = await createWalletClient({
        fetch: createEsiTransport('wallet-journal', authority.principal),
        token: authority.accessToken,
      })
        .withMetadata()
        .listCharacterJournal(characterId, { page, ...revalidation })
      return {
        data: {
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
          page,
          totalPages: paginationPages(response.meta.pagination?.pages, page),
        },
        meta: response.meta,
      }
    },
  })
}

async function loadWalletTransactions(characterId: number, fromId: number | null) {
  return getEsiResilienceLayer().getCharacter<WalletTransactionsData>({
    operation: 'wallet-transactions',
    inputs: { characterId, fromId },
    load: async (authority, revalidation) => {
      const response = await createWalletClient({
        fetch: createEsiTransport('wallet-transactions', authority.principal),
        token: authority.accessToken,
      })
        .withMetadata()
        .listCharacterTransactions(characterId, {
          ...(fromId === null ? {} : { fromId }),
          ...revalidation,
        })
      const personalTransactions = response.data.filter((transaction) => transaction.is_personal)
      const [namesByType, namesByLocation] = await Promise.all([
        loadFinanceTypeNames(personalTransactions.map((transaction) => transaction.type_id)),
        loadFinanceLocationNames(
          personalTransactions.map((transaction) => transaction.location_id),
        ),
      ])

      return {
        data: {
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
          fromId,
          nextFromId:
            response.data.length < walletTransactionPageSize
              ? null
              : Math.min(...response.data.map((transaction) => transaction.transaction_id)),
        },
        meta: response.meta,
      }
    },
  })
}

export async function getWalletBalance(characterId: number): Promise<WalletBalanceResult> {
  try {
    const result = await loadWalletBalance(characterId)
    return { balance: result.data, ...toEsiResultMetadata(result) }
  } catch (error) {
    throwWalletError(error)
  }
}

export async function getWalletJournal(
  characterId: number,
  page: number,
): Promise<WalletJournalResult> {
  assertPositiveSafeInteger(page, 'Wallet journal page')
  try {
    const result = await loadWalletJournal(characterId, page)
    return { ...result.data, ...toEsiResultMetadata(result) }
  } catch (error) {
    throwWalletError(error)
  }
}

export async function getWalletTransactions(
  characterId: number,
  fromId: number | null = null,
): Promise<WalletTransactionsResult> {
  if (fromId !== null) assertPositiveSafeInteger(fromId, 'Wallet transaction continuation')
  try {
    const result = await loadWalletTransactions(characterId, fromId)
    return { ...result.data, ...toEsiResultMetadata(result) }
  } catch (error) {
    throwWalletError(error)
  }
}

function walletJournalContext(entry: EsiWalletJournalEntry) {
  if (
    entry.context_id === undefined ||
    entry.context_id_type === undefined ||
    !Number.isSafeInteger(entry.context_id) ||
    entry.context_id <= 0 ||
    !isSafeJournalContextType(entry.context_id_type)
  )
    return null
  return { id: entry.context_id, type: entry.context_id_type }
}

function isSafeJournalContextType(value: string): value is WalletJournalContextType {
  return safeJournalContextTypeSet.has(value)
}

function paginationPages(value: number | undefined, page: number) {
  if (value === undefined || value === 0) return page
  assertPositiveSafeInteger(value, 'ESI pagination total')
  return value
}

function assertPositiveSafeInteger(value: unknown, name: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0)
    throw new Error(`${name} must be a positive safe integer`)
}

function throwWalletError(error: unknown): never {
  if (error instanceof EsiQuotaError) throw new WalletQuotaError(error.retryAfterSeconds)
  throw error
}
