<script setup lang="ts">
import { useCharacterFinanceContractDetail } from '../../../composables/useCharacterFinanceContractDetail'
import { useCharacterFinanceServices } from '../../../composables/useCharacterFinanceServices'
import { useFinanceLedger } from '../../../composables/useFinanceLedger'
import type {
  FinanceContractFilter,
  FinanceFilterOption,
  FinanceJournalGroupFilter,
  FinanceOrderFilter,
  FinanceOrderMode,
  FinanceRange,
  FinanceTransactionSideFilter,
} from '../../../types/finance'
import { parseRouteId } from '../../../utils/route-id'

definePageMeta({ title: 'Character Finance', layout: 'headerless' })
useHead({ title: 'Character Finance // EVE Space' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { authSession } = useAuthSession(apiClient)
const { characters } = useCharacterRoster(apiClient)
const characterId = computed(() => parseRouteId(route.params.characterId))
const authenticated = computed(() => authSession.value.authenticated)

const services = useCharacterFinanceServices({
  apiClient,
  authenticated,
  characterId,
  characters,
})
const ledger = useFinanceLedger({
  services,
  summaryCopy: {
    awaitingDetail: 'contracts assigned to you · loaded page',
    awaitingLabel: 'Awaiting me',
  },
})
const contractDetail = useCharacterFinanceContractDetail({
  apiClient,
  characterId,
  contractPage: services.contractPage,
  contracts: ledger.contracts,
  financeAccess: services.financeAccess,
  changePage: services.changePage,
  refreshRequestedServices: services.refreshRequestedServices,
})

const {
  balanceQuery,
  changePage,
  contractsQuery,
  journalQuery,
  loadOlderTransactions,
  openOrdersQuery,
  orderHistoryQuery,
  showNewerTransactions,
  transactionQuery,
  transactionRangeIndex,
} = services
const {
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
  orderFilter,
  orderHistory,
  orderMode,
  range,
  reviewAwaitingContracts,
  selectOrderMode,
  selectService,
  showContractsInJournal: selectContractsInJournal,
  summary,
  summaryMetrics,
  transactionSearchQuery,
  transactions,
  transactionSideFilter,
  transactionsState,
} = ledger
const {
  changeContractPage,
  closeContractDrawer,
  contractBids,
  contractBidsQuery,
  contractBidsState,
  contractDrawerOpen,
  contractItems,
  contractItemsQuery,
  contractItemsState,
  openContractDrawer,
  refreshRequestedFinance,
  selectedContract,
  selectedContractId,
} = contractDetail

const serviceBadges = computed(() => ({
  orders: summary.value.expiringOrderCount,
  contracts: summary.value.awaitingContractCount,
}))
const contractFilterOptions: readonly FinanceFilterOption<FinanceContractFilter>[] = [
  { value: 'all', label: 'All' },
  { value: 'awaiting', label: 'Awaiting me' },
  { value: 'active', label: 'Active' },
  { value: 'couriers', label: 'Couriers' },
  { value: 'auctions', label: 'Auctions' },
  { value: 'closed', label: 'Closed' },
]
const displayedOrders = computed(() =>
  orderMode.value === 'open' ? openOrders.value : orderHistory.value,
)

function changeRange(nextRange: FinanceRange) {
  range.value = nextRange
}

function changeJournalFilter(filter: FinanceJournalGroupFilter) {
  journalGroupFilter.value = filter
}

function changeTransactionFilter(filter: FinanceTransactionSideFilter) {
  transactionSideFilter.value = filter
}

function changeTransactionSearch(query: string) {
  transactionSearchQuery.value = query
}

function changeOrderFilter(filter: FinanceOrderFilter) {
  orderFilter.value = filter
}

function changeOrderMode(mode: FinanceOrderMode) {
  selectOrderMode(mode)
}

function changeContractFilter(filter: FinanceContractFilter) {
  contractFilter.value = filter
}

function openContract(contractId: number, event: MouseEvent) {
  openContractDrawer(
    contractId,
    event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined,
  )
}

function refreshBalance() {
  void balanceQuery.refetch()
}

function refreshOrders() {
  void (orderMode.value === 'open' ? openOrdersQuery.refetch() : orderHistoryQuery.refetch())
}

function showContractsInJournal() {
  closeContractDrawer()
  selectContractsInJournal()
}

useCharacterReauthorization(characterId, refreshRequestedFinance)
</script>

<template>
  <section class="character-finance-route" aria-label="Character finance">
    <FinanceSummary
      :balance="balance ?? null"
      balance-label="AUTHORIZED BALANCE / COMPLETE VALUE"
      eyebrow="CHARACTER WALLET"
      :metrics="summaryMetrics"
      :now="currentTime"
      :state="balanceState"
      @refresh="refreshBalance"
      @review-awaiting-contracts="reviewAwaitingContracts"
    >
      <template #icon>
        <UiEveImage kind="type-icon" :id="52996" :dimension="42" alt="" aria-hidden="true" />
      </template>
    </FinanceSummary>

    <FinanceWorkspace
      :active-service="activeService"
      :range="range"
      :service-badges="serviceBadges"
      @activate-service="selectService"
      @change-range="changeRange"
    >
      <template #journal>
        <FinanceJournal
          :entries="filteredJournal"
          :filter="journalGroupFilter"
          :journal="journal ?? null"
          :now="currentTime"
          scope-note="esi-wallet.read_character_wallet.v1"
          :state="journalState"
          @change-filter="changeJournalFilter"
          @change-page="changePage('journal', $event)"
          @refresh="journalQuery.refetch()"
        />
      </template>

      <template #transactions>
        <FinanceTransactions
          empty-message="No personal transactions in this loaded range match the filters."
          :filter="transactionSideFilter"
          :now="currentTime"
          :range-index="transactionRangeIndex"
          :search-query="transactionSearchQuery"
          :state="transactionsState"
          :transaction-rows="filteredTransactions"
          :transactions="transactions ?? null"
          @change-filter="changeTransactionFilter"
          @change-search="changeTransactionSearch"
          @load-older="loadOlderTransactions"
          @refresh="transactionQuery.refetch()"
          @show-newer="showNewerTransactions"
        />
      </template>

      <template #orders>
        <FinanceOrders
          :active-orders="activeOrders"
          empty-message="No personal market orders match this range and filter."
          :filter="orderFilter"
          :mode="orderMode"
          :now="currentTime"
          :order-rows="filteredOrders"
          :orders="displayedOrders ?? null"
          scope-note="Personal orders only · corporation orders excluded"
          :state="activeOrdersState"
          @change-filter="changeOrderFilter"
          @change-mode="changeOrderMode"
          @change-page="changePage('order-history', $event)"
          @refresh="refreshOrders"
        />
      </template>

      <template #contracts>
        <FinanceContracts
          :contract-rows="filteredContracts"
          :contracts="contracts ?? null"
          empty-message="No personal contracts on the loaded page match this range and filter."
          :filter="contractFilter"
          :filter-options="contractFilterOptions"
          :now="currentTime"
          scope-note="Issued by or assigned to this character"
          :selected-contract-id="selectedContractId"
          :state="contractsState"
          title="Character contracts"
          @change-filter="changeContractFilter"
          @change-page="changeContractPage"
          @open-contract="openContract"
          @refresh="contractsQuery.refetch()"
        />
      </template>
    </FinanceWorkspace>

    <FinanceContractDrawer
      bid-privacy-note="Bidder identities are not shown — only your own character's financial position is exposed here."
      :bid-state="contractBidsState"
      :bids="contractBids ?? null"
      :contract="selectedContract ?? null"
      description="Review the selected character contract terms, items, and bids"
      :item-state="contractItemsState"
      :items="contractItems ?? null"
      :now="currentTime"
      :open="contractDrawerOpen"
      @close-contract="closeContractDrawer"
      @retry-bids="contractBidsQuery.refetch()"
      @retry-items="contractItemsQuery.refetch()"
      @show-in-journal="showContractsInJournal"
    />
  </section>
</template>

<style>
@import url('~/assets/css/features/finance.css');
@import url('~/assets/css/responsive/finance.css');
</style>
