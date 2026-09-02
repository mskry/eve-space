import { computed, ref } from 'vue'
import type {
  FinanceContractFilter,
  FinanceJournalGroupFilter,
  FinanceOrderFilter,
  FinanceOrderMode,
  FinanceRange,
  FinanceSummaryCopy,
  FinanceTransactionSideFilter,
} from '../types/finance'
import {
  mapCharacterFinanceBalance,
  mapCharacterFinanceContracts,
  mapCharacterFinanceJournal,
  mapCharacterFinanceOpenOrders,
  mapCharacterFinanceOrderHistory,
  mapCharacterFinanceResourceState,
  mapCharacterFinanceTransactions,
} from '../utils/character-finance-mappers'
import {
  buildFinanceSummaryMetrics,
  calculateFinanceSummary,
  filterFinanceContracts,
  filterFinanceJournalEntries,
  filterFinanceOrders,
  filterFinanceTransactions,
  isWithinFinanceRange,
} from '../utils/finance'
import { useFinanceClock } from './useFinanceClock'
import type {
  CharacterFinanceService,
  useCharacterFinanceServices,
} from './useCharacterFinanceServices'

interface FinanceLedgerOptions {
  services: ReturnType<typeof useCharacterFinanceServices>
  summaryCopy: FinanceSummaryCopy
}

export function useFinanceLedger(options: FinanceLedgerOptions) {
  const activeService = ref<CharacterFinanceService>('journal')
  const range = ref<FinanceRange>('30D')
  const journalGroupFilter = ref<FinanceJournalGroupFilter>('All')
  const transactionSideFilter = ref<FinanceTransactionSideFilter>('All')
  const transactionSearchQuery = ref('')
  const orderMode = ref<FinanceOrderMode>('open')
  const orderFilter = ref<FinanceOrderFilter>('All')
  const contractFilter = ref<FinanceContractFilter>('all')
  const currentTime = useFinanceClock()

  const balance = computed(() => {
    const response = options.services.balance.value
    return response ? mapCharacterFinanceBalance(response) : undefined
  })
  const journal = computed(() => {
    const response = options.services.journal.value
    return response ? mapCharacterFinanceJournal(response) : undefined
  })
  const transactions = computed(() => {
    const response = options.services.transactions.value
    return response ? mapCharacterFinanceTransactions(response) : undefined
  })
  const openOrders = computed(() => {
    const response = options.services.openOrders.value
    return response ? mapCharacterFinanceOpenOrders(response) : undefined
  })
  const orderHistory = computed(() => {
    const response = options.services.orderHistory.value
    return response ? mapCharacterFinanceOrderHistory(response) : undefined
  })
  const contracts = computed(() => {
    const response = options.services.contracts.value
    return response ? mapCharacterFinanceContracts(response) : undefined
  })

  const filteredJournal = computed(() =>
    filterFinanceJournalEntries(
      journal.value?.entries ?? [],
      range.value,
      journalGroupFilter.value,
      currentTime.value,
    ),
  )
  const filteredTransactions = computed(() =>
    filterFinanceTransactions(
      transactions.value?.transactions ?? [],
      range.value,
      transactionSideFilter.value,
      transactionSearchQuery.value,
      currentTime.value,
    ),
  )
  const activeOrders = computed(() =>
    orderMode.value === 'open'
      ? (openOrders.value?.orders ?? [])
      : (orderHistory.value?.orders ?? []).filter((order) =>
          isWithinFinanceRange(order.issuedAt, range.value, currentTime.value),
        ),
  )
  const filteredOrders = computed(() =>
    filterFinanceOrders(
      openOrders.value?.orders ?? [],
      orderHistory.value?.orders ?? [],
      orderMode.value,
      range.value,
      orderFilter.value,
      currentTime.value,
    ),
  )
  const filteredContracts = computed(() =>
    filterFinanceContracts(
      contracts.value?.contracts ?? [],
      range.value,
      contractFilter.value,
      currentTime.value,
    ),
  )
  const summary = computed(() =>
    calculateFinanceSummary({
      journal: journal.value,
      openOrders: openOrders.value,
      contracts: contracts.value,
      range: range.value,
      now: currentTime.value,
    }),
  )
  const summaryMetrics = computed(() =>
    buildFinanceSummaryMetrics(summary.value, options.summaryCopy),
  )

  const balanceState = computed(() =>
    mapCharacterFinanceResourceState({
      data: balance.value,
      error: options.services.balanceQuery.error.value,
      loading: options.services.balanceQuery.asyncStatus.value === 'loading',
      authorizationLabel: 'AUTHORIZE WALLET',
    }),
  )
  const journalState = computed(() =>
    mapCharacterFinanceResourceState({
      data: journal.value,
      error: options.services.journalQuery.error.value,
      loading: options.services.journalQuery.asyncStatus.value === 'loading',
    }),
  )
  const transactionsState = computed(() =>
    mapCharacterFinanceResourceState({
      data: transactions.value,
      error: options.services.transactionQuery.error.value,
      loading: options.services.transactionQuery.asyncStatus.value === 'loading',
    }),
  )
  const openOrdersState = computed(() =>
    mapCharacterFinanceResourceState({
      data: openOrders.value,
      error: options.services.openOrdersQuery.error.value,
      loading: options.services.openOrdersQuery.asyncStatus.value === 'loading',
    }),
  )
  const orderHistoryState = computed(() =>
    mapCharacterFinanceResourceState({
      data: orderHistory.value,
      error: options.services.orderHistoryQuery.error.value,
      loading: options.services.orderHistoryQuery.asyncStatus.value === 'loading',
    }),
  )
  const contractsState = computed(() =>
    mapCharacterFinanceResourceState({
      data: contracts.value,
      error: options.services.contractsQuery.error.value,
      loading: options.services.contractsQuery.asyncStatus.value === 'loading',
    }),
  )
  const activeOrdersState = computed(() =>
    orderMode.value === 'open' ? openOrdersState.value : orderHistoryState.value,
  )

  function selectService(service: CharacterFinanceService) {
    activeService.value = service
    options.services.activateService(service)
  }

  function selectOrderMode(mode: FinanceOrderMode) {
    orderMode.value = mode
    options.services.activateOrderMode(mode)
    orderFilter.value = 'All'
  }

  function reviewAwaitingContracts() {
    selectService('contracts')
    contractFilter.value = 'awaiting'
  }

  function showContractsInJournal() {
    selectService('journal')
    journalGroupFilter.value = 'Contracts'
  }

  return {
    activeOrders,
    activeOrdersState,
    activeService,
    balance,
    balanceState,
    contractFilter,
    contracts,
    contractsState,
    currentTime,
    filteredContracts,
    filteredJournal,
    filteredOrders,
    filteredTransactions,
    journal,
    journalGroupFilter,
    journalState,
    openOrders,
    openOrdersState,
    orderFilter,
    orderHistory,
    orderHistoryState,
    orderMode,
    range,
    reviewAwaitingContracts,
    selectOrderMode,
    selectService,
    showContractsInJournal,
    summary,
    summaryMetrics,
    transactionSearchQuery,
    transactions,
    transactionSideFilter,
    transactionsState,
  }
}
