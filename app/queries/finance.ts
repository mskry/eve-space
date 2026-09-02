import { defineQueryOptions } from '@pinia/colada'
import type { InferResponseType } from 'hono/client'
import type { ApiClient } from '../utils/api-client'
import { ApiQueryError, toApiQueryError } from '../utils/query-error'
import { PRIVATE_QUERY_KEYS } from './query-keys'
import { QUERY_POLICY } from './query-policy'

type CharacterClient = ApiClient['api']['me']['characters'][':characterId']
type ContractClient = CharacterClient['contracts'][':contractId']

type CharacterFinanceBalance = InferResponseType<CharacterClient['wallet']['$get'], 200>
type CharacterFinanceJournal = InferResponseType<CharacterClient['wallet']['journal']['$get'], 200>
type CharacterFinanceTransactions = InferResponseType<
  CharacterClient['wallet']['transactions']['$get'],
  200
>
type CharacterFinanceOpenOrders = InferResponseType<
  CharacterClient['market']['orders']['$get'],
  200
>
type CharacterFinanceOrderHistory = InferResponseType<
  CharacterClient['market']['orders']['history']['$get'],
  200
>
type CharacterFinanceContracts = InferResponseType<CharacterClient['contracts']['$get'], 200>
type CharacterFinanceContractItems = InferResponseType<ContractClient['items']['$get'], 200>
type CharacterFinanceContractBids = InferResponseType<ContractClient['bids']['$get'], 200>

export interface CharacterFinanceAccess {
  isClient: boolean
  authenticated: boolean
  ownsCharacter: boolean
}

interface FinanceQueryParameters {
  apiClient: ApiClient
  characterId: number
  access: CharacterFinanceAccess
}

interface RequestedFinanceQueryParameters extends FinanceQueryParameters {
  requested: boolean
}

interface PagedFinanceQueryParameters extends RequestedFinanceQueryParameters {
  page: number
}

interface TransactionQueryParameters extends RequestedFinanceQueryParameters {
  fromId: number | null
}

interface ContractDetailQueryParameters extends RequestedFinanceQueryParameters {
  contractId: number
  contractPage: number
}

const financeIdentityMismatch = () =>
  new ApiQueryError('Finance response did not match the requested identity.', {
    status: 409,
    code: 'FINANCE_IDENTITY_MISMATCH',
  })

export function canRunCharacterFinanceQuery(
  access: CharacterFinanceAccess,
  characterId: number,
  requested = true,
) {
  return (
    access.isClient &&
    access.authenticated &&
    access.ownsCharacter &&
    requested &&
    isPositiveSafeInteger(characterId)
  )
}

export const characterFinanceBalanceQuery = defineQueryOptions(
  ({ apiClient, characterId, access }: FinanceQueryParameters) => ({
    key: PRIVATE_QUERY_KEYS.characterFinanceBalance(characterId),
    query: async ({ signal }) => {
      const response = await apiClient.api.me.characters[':characterId'].wallet.$get(
        { param: { characterId: String(characterId) } },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Wallet balance is unavailable.')
      }
      const balance: CharacterFinanceBalance = await response.json()
      assertCharacterIdentity(balance, characterId)
      return balance
    },
    ...QUERY_POLICY.characterFinanceBalance,
    enabled: canRunCharacterFinanceQuery(access, characterId),
  }),
)

export const characterFinanceJournalQuery = defineQueryOptions(
  ({ apiClient, characterId, access, requested, page }: PagedFinanceQueryParameters) => ({
    key: PRIVATE_QUERY_KEYS.characterFinanceJournal(characterId, page),
    query: async ({ signal }) => {
      const response = await apiClient.api.me.characters[':characterId'].wallet.journal.$get(
        { param: { characterId: String(characterId) }, query: { page: String(page) } },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Wallet journal is unavailable.')
      }
      const journal: CharacterFinanceJournal = await response.json()
      assertCharacterIdentity(journal, characterId)
      assertPageIdentity(journal, page)
      return journal
    },
    ...QUERY_POLICY.characterFinanceJournal,
    enabled:
      canRunCharacterFinanceQuery(access, characterId, requested) && isPositiveSafeInteger(page),
  }),
)

export const characterFinanceTransactionsQuery = defineQueryOptions(
  ({ apiClient, characterId, access, requested, fromId }: TransactionQueryParameters) => ({
    key: PRIVATE_QUERY_KEYS.characterFinanceTransactions(characterId, fromId),
    query: async ({ signal }) => {
      const response = await apiClient.api.me.characters[':characterId'].wallet.transactions.$get(
        {
          param: { characterId: String(characterId) },
          query: fromId === null ? {} : { fromId: String(fromId) },
        },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Wallet transactions are unavailable.')
      }
      const transactions: CharacterFinanceTransactions = await response.json()
      assertCharacterIdentity(transactions, characterId)
      if (transactions.fromId !== fromId) throw financeIdentityMismatch()
      return transactions
    },
    ...QUERY_POLICY.characterFinanceTransactions,
    enabled:
      canRunCharacterFinanceQuery(access, characterId, requested) &&
      (fromId === null || isPositiveSafeInteger(fromId)),
  }),
)

export const characterFinanceOpenOrdersQuery = defineQueryOptions(
  ({ apiClient, characterId, access, requested }: RequestedFinanceQueryParameters) => ({
    key: PRIVATE_QUERY_KEYS.characterFinanceOpenOrders(characterId),
    query: async ({ signal }) => {
      const response = await apiClient.api.me.characters[':characterId'].market.orders.$get(
        { param: { characterId: String(characterId) } },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Character market orders are unavailable.')
      }
      const orders: CharacterFinanceOpenOrders = await response.json()
      assertCharacterIdentity(orders, characterId)
      return orders
    },
    ...QUERY_POLICY.characterFinanceOpenOrders,
    enabled: canRunCharacterFinanceQuery(access, characterId, requested),
  }),
)

export const characterFinanceOrderHistoryQuery = defineQueryOptions(
  ({ apiClient, characterId, access, requested, page }: PagedFinanceQueryParameters) => ({
    key: PRIVATE_QUERY_KEYS.characterFinanceOrderHistory(characterId, page),
    query: async ({ signal }) => {
      const response = await apiClient.api.me.characters[':characterId'].market.orders.history.$get(
        { param: { characterId: String(characterId) }, query: { page: String(page) } },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Character market order history is unavailable.')
      }
      const history: CharacterFinanceOrderHistory = await response.json()
      assertCharacterIdentity(history, characterId)
      assertPageIdentity(history, page)
      return history
    },
    ...QUERY_POLICY.characterFinanceOrderHistory,
    enabled:
      canRunCharacterFinanceQuery(access, characterId, requested) && isPositiveSafeInteger(page),
  }),
)

export const characterFinanceContractsQuery = defineQueryOptions(
  ({ apiClient, characterId, access, requested, page }: PagedFinanceQueryParameters) => ({
    key: PRIVATE_QUERY_KEYS.characterFinanceContractPage(characterId, page),
    query: async ({ signal }) => {
      const response = await apiClient.api.me.characters[':characterId'].contracts.$get(
        { param: { characterId: String(characterId) }, query: { page: String(page) } },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Character contracts are unavailable.')
      }
      const contracts: CharacterFinanceContracts = await response.json()
      assertCharacterIdentity(contracts, characterId)
      assertPageIdentity(contracts, page)
      return contracts
    },
    ...QUERY_POLICY.characterFinanceContracts,
    enabled:
      canRunCharacterFinanceQuery(access, characterId, requested) && isPositiveSafeInteger(page),
  }),
)

export const characterFinanceContractItemsQuery = defineQueryOptions(
  ({
    apiClient,
    characterId,
    access,
    requested,
    contractId,
    contractPage,
  }: ContractDetailQueryParameters) => ({
    key: PRIVATE_QUERY_KEYS.characterFinanceContractItems(characterId, contractId),
    query: async ({ signal }) => {
      const response = await apiClient.api.me.characters[':characterId'].contracts[
        ':contractId'
      ].items.$get(
        {
          param: { characterId: String(characterId), contractId: String(contractId) },
          query: { contractPage: String(contractPage) },
        },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Character contract items are unavailable.')
      }
      const items: CharacterFinanceContractItems = await response.json()
      assertContractIdentity(items, characterId, contractId)
      return items
    },
    ...QUERY_POLICY.characterFinanceContractItems,
    enabled: canRunContractDetailQuery(access, characterId, requested, contractId, contractPage),
  }),
)

export const characterFinanceContractBidsQuery = defineQueryOptions(
  ({
    apiClient,
    characterId,
    access,
    requested,
    contractId,
    contractPage,
  }: ContractDetailQueryParameters) => ({
    key: PRIVATE_QUERY_KEYS.characterFinanceContractBids(characterId, contractId),
    query: async ({ signal }) => {
      const response = await apiClient.api.me.characters[':characterId'].contracts[
        ':contractId'
      ].bids.$get(
        {
          param: { characterId: String(characterId), contractId: String(contractId) },
          query: { contractPage: String(contractPage) },
        },
        { init: { signal } },
      )
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Character contract bids are unavailable.')
      }
      const bids: CharacterFinanceContractBids = await response.json()
      assertContractIdentity(bids, characterId, contractId)
      return bids
    },
    ...QUERY_POLICY.characterFinanceContractBids,
    enabled: canRunContractDetailQuery(access, characterId, requested, contractId, contractPage),
  }),
)

function canRunContractDetailQuery(
  access: CharacterFinanceAccess,
  characterId: number,
  requested: boolean,
  contractId: number,
  contractPage: number,
) {
  return (
    canRunCharacterFinanceQuery(access, characterId, requested) &&
    isPositiveSafeInteger(contractId) &&
    isPositiveSafeInteger(contractPage)
  )
}

function assertCharacterIdentity(value: { characterId: number }, characterId: number) {
  if (value.characterId !== characterId) throw financeIdentityMismatch()
}

function assertPageIdentity(value: { page: number }, page: number) {
  if (value.page !== page) throw financeIdentityMismatch()
}

function assertContractIdentity(
  value: { characterId: number; contractId: number },
  characterId: number,
  contractId: number,
) {
  if (value.characterId !== characterId || value.contractId !== contractId) {
    throw financeIdentityMismatch()
  }
}

function isPositiveSafeInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0
}
