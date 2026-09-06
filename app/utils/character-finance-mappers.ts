import type { InferResponseType } from 'hono/client'
import type {
  FinanceBalance,
  FinanceContractBids,
  FinanceContractItems,
  FinanceContracts,
  FinanceJournal,
  FinanceOrderHistory,
  FinanceOrders,
  FinanceResourceState,
  FinanceTransactions,
} from '../types/finance'
import type { ApiClient } from './api-client'
import { ApiQueryError } from './query-error'

type CharacterClient = ApiClient['api']['me']['characters'][':characterId']
type ContractClient = CharacterClient['contracts'][':contractId']

export type CharacterFinanceBalanceResponse = InferResponseType<
  CharacterClient['wallet']['$get'],
  200
>
export type CharacterFinanceJournalResponse = InferResponseType<
  CharacterClient['wallet']['journal']['$get'],
  200
>
export type CharacterFinanceTransactionsResponse = InferResponseType<
  CharacterClient['wallet']['transactions']['$get'],
  200
>
export type CharacterFinanceOpenOrdersResponse = InferResponseType<
  CharacterClient['market']['orders']['$get'],
  200
>
export type CharacterFinanceOrderHistoryResponse = InferResponseType<
  CharacterClient['market']['orders']['history']['$get'],
  200
>
export type CharacterFinanceContractsResponse = InferResponseType<
  CharacterClient['contracts']['$get'],
  200
>
export type CharacterFinanceContractItemsResponse = InferResponseType<
  ContractClient['items']['$get'],
  200
>
export type CharacterFinanceContractBidsResponse = InferResponseType<
  ContractClient['bids']['$get'],
  200
>

export function mapCharacterFinanceBalance(
  response: CharacterFinanceBalanceResponse,
): FinanceBalance {
  return {
    balance: response.balance,
    validatedAt: response.validatedAt,
    stale: response.stale,
  }
}

export function mapCharacterFinanceJournal(
  response: CharacterFinanceJournalResponse,
): FinanceJournal {
  return {
    entries: response.entries.map((entry) => ({
      journalId: entry.journalId,
      date: entry.date,
      amount: entry.amount,
      balance: entry.balance,
      referenceType: entry.referenceType,
      description: entry.description,
    })),
    page: response.page,
    totalPages: response.totalPages,
    validatedAt: response.validatedAt,
    stale: response.stale,
  }
}

export function mapCharacterFinanceTransactions(
  response: CharacterFinanceTransactionsResponse,
): FinanceTransactions {
  return {
    transactions: response.transactions.map((transaction) => ({
      transactionId: transaction.transactionId,
      date: transaction.date,
      typeId: transaction.typeId,
      typeName: transaction.typeName,
      quantity: transaction.quantity,
      unitPrice: transaction.unitPrice,
      totalPrice: transaction.totalPrice,
      isBuy: transaction.isBuy,
      locationId: transaction.locationId,
      locationName: transaction.locationName,
    })),
    fromId: response.fromId,
    nextFromId: response.nextFromId,
    validatedAt: response.validatedAt,
    stale: response.stale,
  }
}

export function mapCharacterFinanceOpenOrders(
  response: CharacterFinanceOpenOrdersResponse,
): FinanceOrders {
  return {
    orders: response.orders.map((order) => ({
      orderId: order.orderId,
      typeId: order.typeId,
      typeName: order.typeName,
      isBuy: order.isBuy,
      price: order.price,
      volumeRemain: order.volumeRemain,
      volumeTotal: order.volumeTotal,
      escrow: order.escrow,
      range: order.range,
      locationId: order.locationId,
      locationName: order.locationName,
      issuedAt: order.issuedAt,
      expiresAt: order.expiresAt,
      state: null,
    })),
    validatedAt: response.validatedAt,
    stale: response.stale,
  }
}

export function mapCharacterFinanceOrderHistory(
  response: CharacterFinanceOrderHistoryResponse,
): FinanceOrderHistory {
  return {
    orders: response.orders.map((order) => ({
      orderId: order.orderId,
      typeId: order.typeId,
      typeName: order.typeName,
      isBuy: order.isBuy,
      price: order.price,
      volumeRemain: order.volumeRemain,
      volumeTotal: order.volumeTotal,
      escrow: order.escrow,
      range: order.range,
      locationId: order.locationId,
      locationName: order.locationName,
      issuedAt: order.issuedAt,
      expiresAt: order.expiresAt,
      state: order.state,
    })),
    page: response.page,
    totalPages: response.totalPages,
    validatedAt: response.validatedAt,
    stale: response.stale,
  }
}

export function mapCharacterFinanceContracts(
  response: CharacterFinanceContractsResponse,
): FinanceContracts {
  return {
    contracts: response.contracts.map((contract) => ({
      contractId: contract.contractId,
      type: contract.type,
      status: contract.status,
      availability: contract.availability,
      role: contract.role,
      title: contract.title,
      issuedAt: contract.issuedAt,
      expiredAt: contract.expiredAt,
      daysToComplete: contract.daysToComplete,
      price: contract.price,
      reward: contract.reward,
      collateral: contract.collateral,
      volume: contract.volume,
    })),
    page: response.page,
    totalPages: response.totalPages,
    validatedAt: response.validatedAt,
    stale: response.stale,
  }
}

export function mapCharacterFinanceContractItems(
  response: CharacterFinanceContractItemsResponse,
): FinanceContractItems {
  return {
    items: response.items.map((item) => ({
      recordId: item.recordId,
      typeId: item.typeId,
      typeName: item.typeName,
      direction: item.direction,
      quantity: item.quantity,
      blueprint: item.blueprint,
    })),
    validatedAt: response.validatedAt,
    stale: response.stale,
  }
}

export function mapCharacterFinanceContractBids(
  response: CharacterFinanceContractBidsResponse,
): FinanceContractBids {
  return {
    bids: response.bids.map((bid) => ({
      bidId: bid.bidId,
      amount: bid.amount,
      bidAt: bid.bidAt,
    })),
    validatedAt: response.validatedAt,
    stale: response.stale,
  }
}

export function mapCharacterFinanceResourceState({
  data,
  error,
  loading,
  authorizationLabel = 'AUTHORIZE THIS CHARACTER',
}: {
  data?: { stale: boolean } | null
  error: unknown
  loading: boolean
  authorizationLabel?: string
}): FinanceResourceState {
  const normalizedError = error instanceof Error ? error : null
  const apiError = normalizedError instanceof ApiQueryError ? normalizedError : null
  const authorizationRequired =
    apiError?.code === 'EVE_SCOPE_REQUIRED' || apiError?.code === 'EVE_REAUTH_REQUIRED'
  const authorizationAction =
    authorizationRequired && apiError.authorizeUrl
      ? { href: apiError.authorizeUrl, label: authorizationLabel }
      : null
  let errorCode: string | null = null
  if (normalizedError) {
    errorCode =
      apiError?.status === 429 ? 'ESI / QUOTA' : `ESI ${apiError?.status ?? 502} / FINANCE`
  }

  return {
    authorizationRequired,
    loading,
    stale: data?.stale ?? false,
    errorCode,
    errorMessage: financeErrorMessage(normalizedError, apiError),
    canRetry: normalizedError !== null && !authorizationRequired,
    authorizationAction,
  }
}

function financeErrorMessage(error: Error | null, apiError: ApiQueryError | null) {
  if (!error) return null
  const message = error.message.trim()
    ? error.message
    : 'This Finance resource is temporarily unavailable.'
  return apiError?.status === 429 && apiError.retryAfterSeconds !== undefined
    ? `${message} Retry after ${apiError.retryAfterSeconds} seconds.`
    : message
}
