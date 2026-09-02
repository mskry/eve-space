import { useQuery } from '@pinia/colada'
import { computed, readonly, ref, type Ref } from 'vue'
import {
  characterFinanceBalanceQuery,
  characterFinanceContractsQuery,
  characterFinanceJournalQuery,
  characterFinanceOpenOrdersQuery,
  characterFinanceOrderHistoryQuery,
  characterFinanceTransactionsQuery,
  type CharacterFinanceAccess,
} from '../queries/finance'
import type { FinanceOrderMode } from '../types/finance'
import type { ApiClient } from '../utils/api-client'

export type CharacterFinanceService = 'journal' | 'transactions' | 'orders' | 'contracts'
export type CharacterFinancePageResource = 'journal' | 'order-history' | 'contracts'

interface CharacterFinanceServicesOptions {
  apiClient: ApiClient
  authenticated: Readonly<Ref<boolean>>
  characterId: Readonly<Ref<number | undefined>>
  characters: Readonly<Ref<readonly { characterId: number }[]>>
  isClient?: boolean
}

export function useCharacterFinanceServices(options: CharacterFinanceServicesOptions) {
  const isClient = options.isClient ?? import.meta.client
  const journalRequested = ref(true)
  const transactionsRequested = ref(false)
  const openOrdersRequested = ref(false)
  const orderHistoryRequested = ref(false)
  const contractsRequested = ref(false)
  const journalPage = ref(1)
  const orderHistoryPage = ref(1)
  const contractPage = ref(1)
  const transactionContinuations = ref<Array<number | null>>([null])
  const transactionRangeIndex = ref(0)

  const financeAccess = computed<CharacterFinanceAccess>(() => ({
    isClient,
    authenticated: options.authenticated.value,
    ownsCharacter: options.characters.value.some(
      (character) => character.characterId === options.characterId.value,
    ),
  }))
  const transactionFromId = computed(
    () => transactionContinuations.value[transactionRangeIndex.value] ?? null,
  )

  const balanceQuery = useQuery(() =>
    characterFinanceBalanceQuery({
      apiClient: options.apiClient,
      characterId: options.characterId.value ?? 0,
      access: financeAccess.value,
    }),
  )
  const journalQuery = useQuery(() =>
    characterFinanceJournalQuery({
      apiClient: options.apiClient,
      characterId: options.characterId.value ?? 0,
      access: financeAccess.value,
      requested: journalRequested.value,
      page: journalPage.value,
    }),
  )
  const transactionQuery = useQuery(() =>
    characterFinanceTransactionsQuery({
      apiClient: options.apiClient,
      characterId: options.characterId.value ?? 0,
      access: financeAccess.value,
      requested: transactionsRequested.value,
      fromId: transactionFromId.value,
    }),
  )
  const openOrdersQuery = useQuery(() =>
    characterFinanceOpenOrdersQuery({
      apiClient: options.apiClient,
      characterId: options.characterId.value ?? 0,
      access: financeAccess.value,
      requested: openOrdersRequested.value,
    }),
  )
  const orderHistoryQuery = useQuery(() =>
    characterFinanceOrderHistoryQuery({
      apiClient: options.apiClient,
      characterId: options.characterId.value ?? 0,
      access: financeAccess.value,
      requested: orderHistoryRequested.value,
      page: orderHistoryPage.value,
    }),
  )
  const contractsQuery = useQuery(() =>
    characterFinanceContractsQuery({
      apiClient: options.apiClient,
      characterId: options.characterId.value ?? 0,
      access: financeAccess.value,
      requested: contractsRequested.value,
      page: contractPage.value,
    }),
  )

  function activateService(service: CharacterFinanceService) {
    if (service === 'transactions') transactionsRequested.value = true
    if (service === 'orders') openOrdersRequested.value = true
    if (service === 'contracts') contractsRequested.value = true
  }

  function activateOrderMode(mode: FinanceOrderMode) {
    if (mode === 'history') orderHistoryRequested.value = true
  }

  function changePage(resource: CharacterFinancePageResource, nextPage: number) {
    if (!Number.isSafeInteger(nextPage) || nextPage < 1) return false
    if (resource === 'journal') journalPage.value = nextPage
    if (resource === 'order-history') orderHistoryPage.value = nextPage
    if (resource === 'contracts') contractPage.value = nextPage
    return true
  }

  function loadOlderTransactions() {
    const nextFromId = transactionQuery.data.value?.nextFromId
    if (nextFromId === null || nextFromId === undefined) return false
    transactionContinuations.value = [
      ...transactionContinuations.value.slice(0, transactionRangeIndex.value + 1),
      nextFromId,
    ]
    transactionRangeIndex.value += 1
    return true
  }

  function showNewerTransactions() {
    if (transactionRangeIndex.value === 0) return false
    transactionRangeIndex.value -= 1
    return true
  }

  function refreshRequestedServices() {
    const refreshes: Promise<unknown>[] = [balanceQuery.refetch()]
    if (journalRequested.value) refreshes.push(journalQuery.refetch())
    if (transactionsRequested.value) refreshes.push(transactionQuery.refetch())
    if (openOrdersRequested.value) refreshes.push(openOrdersQuery.refetch())
    if (orderHistoryRequested.value) refreshes.push(orderHistoryQuery.refetch())
    if (contractsRequested.value) refreshes.push(contractsQuery.refetch())
    return Promise.all(refreshes)
  }

  return {
    activateOrderMode,
    activateService,
    balance: balanceQuery.data,
    balanceQuery,
    changePage,
    contractPage: readonly(contractPage),
    contracts: contractsQuery.data,
    contractsQuery,
    contractsRequested: readonly(contractsRequested),
    financeAccess,
    journal: journalQuery.data,
    journalPage: readonly(journalPage),
    journalQuery,
    journalRequested: readonly(journalRequested),
    loadOlderTransactions,
    openOrders: openOrdersQuery.data,
    openOrdersQuery,
    openOrdersRequested: readonly(openOrdersRequested),
    orderHistory: orderHistoryQuery.data,
    orderHistoryPage: readonly(orderHistoryPage),
    orderHistoryQuery,
    orderHistoryRequested: readonly(orderHistoryRequested),
    refreshRequestedServices,
    showNewerTransactions,
    transactionContinuations: readonly(transactionContinuations),
    transactionFromId,
    transactionQuery,
    transactionRangeIndex: readonly(transactionRangeIndex),
    transactions: transactionQuery.data,
    transactionsRequested: readonly(transactionsRequested),
  }
}
