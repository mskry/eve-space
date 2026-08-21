import { createWalletClient } from '@evespace/esi-client/domains/wallet'
import { inArray } from 'drizzle-orm'
import { db } from './db/client.js'
import { sdeTypes } from './db/schema.js'
import { createCharacterResourceCache, EsiQuotaError } from './esi-cache.js'
import type { EsiQuota } from './esi-cache.js'
import { esiFetch } from './esi-fetch.js'

export const walletScope = 'esi-wallet.read_character_wallet.v1'

export interface WalletBalanceResult {
  balance: number
  cachedUntil: string
  source: 'esi' | 'cache' | 'not-modified'
  stale: boolean
  retryAt?: string
  quota: EsiQuota
}

export interface WalletTransactionsResult {
  transactions: Array<{
    transactionId: number
    date: string
    typeId: number
    typeName: string
    quantity: number
    unitPrice: number
    totalPrice: number
    isBuy: boolean
    isPersonal: boolean
    clientId: number
    locationId: number
  }>
  cachedUntil: string
  source: 'esi' | 'cache' | 'not-modified'
  stale: boolean
  retryAt?: string
  quota: EsiQuota
}

export class WalletQuotaError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('ESI wallet quota is temporarily exhausted')
  }
}

const walletCache = createCharacterResourceCache<number>({
  scope: walletScope,
  load: (characterId, accessToken, revalidation) =>
    createWalletClient({ fetch: esiFetch, token: accessToken })
      .withMetadata()
      .getCharacterBalance(characterId, revalidation),
})

const walletTransactionsCache = createCharacterResourceCache<
  WalletTransactionsResult['transactions']
>({
  scope: walletScope,
  load: async (characterId, accessToken, revalidation) => {
    const response = await createWalletClient({ fetch: esiFetch, token: accessToken })
      .withMetadata()
      .listCharacterTransactions(characterId, revalidation)
    const typeIds = [...new Set(response.data.map((transaction) => transaction.type_id))]
    const staticRows = typeIds.length
      ? await db
          .select({ typeId: sdeTypes.typeId, typeName: sdeTypes.name })
          .from(sdeTypes)
          .where(inArray(sdeTypes.typeId, typeIds))
      : []
    const namesByType = new Map(staticRows.map((row) => [row.typeId, row.typeName]))

    return {
      data: response.data
        .map((transaction) => ({
          transactionId: transaction.transaction_id,
          date: transaction.date,
          typeId: transaction.type_id,
          typeName: namesByType.get(transaction.type_id) ?? `Unknown type ${transaction.type_id}`,
          quantity: transaction.quantity,
          unitPrice: transaction.unit_price,
          totalPrice: transaction.quantity * transaction.unit_price,
          isBuy: transaction.is_buy,
          isPersonal: transaction.is_personal,
          clientId: transaction.client_id,
          locationId: transaction.location_id,
        }))
        .toSorted((left, right) => Date.parse(right.date) - Date.parse(left.date)),
      meta: response.meta,
    }
  },
})

export async function getWalletBalance(characterId: number): Promise<WalletBalanceResult> {
  try {
    const { data, ...rest } = await walletCache.get(characterId)
    return { balance: data, ...rest }
  } catch (error) {
    throwWalletError(error)
  }
}

export async function getWalletTransactions(
  characterId: number,
): Promise<WalletTransactionsResult> {
  try {
    const { data, ...rest } = await walletTransactionsCache.get(characterId)
    return { transactions: data, ...rest }
  } catch (error) {
    throwWalletError(error)
  }
}

function throwWalletError(error: unknown): never {
  if (error instanceof EsiQuotaError) throw new WalletQuotaError(error.retryAfterSeconds)
  throw error
}
