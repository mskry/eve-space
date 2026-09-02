<script setup lang="ts">
import { useQuery, useQueryCache } from '@pinia/colada'
import {
  characterFinanceBalanceQuery,
  characterFinanceContractBidsQuery,
  characterFinanceContractItemsQuery,
  characterFinanceContractsQuery,
  characterFinanceJournalQuery,
  characterFinanceOpenOrdersQuery,
  characterFinanceOrderHistoryQuery,
  characterFinanceTransactionsQuery,
  type CharacterFinanceAccess,
} from '../../../queries/finance'
import { prefetchQuery } from '../../../queries/query-cache'
import { ApiQueryError } from '../../../utils/query-error'
import { parseRouteId } from '../../../utils/route-id'

type LedgerTab = 'journal' | 'transactions' | 'orders' | 'contracts'
type LedgerRange = '7D' | '30D' | '90D' | 'ALL'

definePageMeta({ title: 'Character Finance', layout: 'headerless' })
useHead({ title: 'Character Finance // EVE Space' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const queryCache = useQueryCache()
const { authSession } = useAuthSession(apiClient)
const { characters } = useCharacterRoster(apiClient)
const characterId = computed(() => parseRouteId(route.params.characterId))
const financeAccess = computed<CharacterFinanceAccess>(() => ({
  isClient: import.meta.client,
  authenticated: authSession.value.authenticated,
  ownsCharacter: characters.value.some((character) => character.characterId === characterId.value),
}))

const activeTab = ref<LedgerTab>('journal')
const range = ref<LedgerRange>('30D')
const orderMode = ref<'open' | 'history'>('open')
const currentTime = ref(0)
let clockTimer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  currentTime.value = Date.now()
  clockTimer = setInterval(() => {
    currentTime.value = Date.now()
  }, 30_000)
})
onBeforeUnmount(() => clearInterval(clockTimer))

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
const transactionFromId = computed(
  () => transactionContinuations.value[transactionRangeIndex.value] ?? null,
)

const balanceQuery = useQuery(() =>
  characterFinanceBalanceQuery({
    apiClient,
    characterId: characterId.value ?? 0,
    access: financeAccess.value,
  }),
)
const journalQuery = useQuery(() =>
  characterFinanceJournalQuery({
    apiClient,
    characterId: characterId.value ?? 0,
    access: financeAccess.value,
    requested: journalRequested.value,
    page: journalPage.value,
  }),
)
const transactionQuery = useQuery(() =>
  characterFinanceTransactionsQuery({
    apiClient,
    characterId: characterId.value ?? 0,
    access: financeAccess.value,
    requested: transactionsRequested.value,
    fromId: transactionFromId.value,
  }),
)
const openOrdersQuery = useQuery(() =>
  characterFinanceOpenOrdersQuery({
    apiClient,
    characterId: characterId.value ?? 0,
    access: financeAccess.value,
    requested: openOrdersRequested.value,
  }),
)
const orderHistoryQuery = useQuery(() =>
  characterFinanceOrderHistoryQuery({
    apiClient,
    characterId: characterId.value ?? 0,
    access: financeAccess.value,
    requested: orderHistoryRequested.value,
    page: orderHistoryPage.value,
  }),
)
const contractsQuery = useQuery(() =>
  characterFinanceContractsQuery({
    apiClient,
    characterId: characterId.value ?? 0,
    access: financeAccess.value,
    requested: contractsRequested.value,
    page: contractPage.value,
  }),
)

const balance = balanceQuery.data
const journal = journalQuery.data
const transactions = transactionQuery.data
const openOrders = openOrdersQuery.data
const orderHistory = orderHistoryQuery.data
const contracts = contractsQuery.data

type OpenOrder = NonNullable<typeof openOrders.value>['orders'][number]
type OrderHistoryEntry = NonNullable<typeof orderHistory.value>['orders'][number]

const selectedContractId = ref<number>()
const contractTrigger = ref<HTMLElement>()
const requestedItemPages = ref(new Map<number, number>())
const requestedBidPages = ref(new Map<number, number>())
const selectedContract = computed(() =>
  contracts.value?.contracts.find((contract) => contract.contractId === selectedContractId.value),
)
const contractDrawerOpen = computed({
  get: () => selectedContract.value !== undefined,
  set: (open: boolean) => {
    if (!open) closeContractDrawer()
  },
})
const selectedContractItemsRequested = computed(
  () =>
    selectedContractId.value !== undefined &&
    requestedItemPages.value.has(selectedContractId.value),
)
const selectedContractBidsRequested = computed(
  () =>
    selectedContractId.value !== undefined && requestedBidPages.value.has(selectedContractId.value),
)
const contractItemsQuery = useQuery(() =>
  characterFinanceContractItemsQuery({
    apiClient,
    characterId: characterId.value ?? 0,
    access: financeAccess.value,
    requested: selectedContractItemsRequested.value,
    contractId: selectedContractId.value ?? 0,
    contractPage: contractPage.value,
  }),
)
const contractBidsQuery = useQuery(() =>
  characterFinanceContractBidsQuery({
    apiClient,
    characterId: characterId.value ?? 0,
    access: financeAccess.value,
    requested: selectedContractBidsRequested.value,
    contractId: selectedContractId.value ?? 0,
    contractPage: contractPage.value,
  }),
)
const contractItems = contractItemsQuery.data
const contractBids = contractBidsQuery.data
const contractItemsError = computed(() => queryError(contractItemsQuery.error.value))
const contractBidsError = computed(() => queryError(contractBidsQuery.error.value))

const journalGroupFilter = ref('All')
const transactionSideFilter = ref('All')
const transactionQueryFilter = ref('')
const orderFilter = ref('All')
const contractFilter = ref('All')

const balanceError = computed(() => queryError(balanceQuery.error.value))
const balanceScopeRequired = computed(() => isScopeError(balanceError.value))
const balanceMessage = computed(() => financeErrorMessage(balanceError.value))
const formattedBalance = computed(() =>
  balance.value ? formatIsk(balance.value.balance) : 'UNAVAILABLE',
)

const rangedJournal = computed(() =>
  (journal.value?.entries ?? []).filter((entry) => withinRange(entry.date)),
)
const filteredJournal = computed(() => {
  const group = journalGroupFilter.value
  return rangedJournal.value.filter((entry) => {
    if (group === 'All') return true
    if (group === 'Income') return (entry.amount ?? 0) > 0
    if (group === 'Expense') return (entry.amount ?? 0) < 0
    return journalGroup(entry.referenceType) === group
  })
})
const filteredTransactions = computed(() => {
  const side = transactionSideFilter.value
  const search = transactionQueryFilter.value.trim().toLocaleLowerCase('en-US')
  return (transactions.value?.transactions ?? [])
    .filter((transaction) => withinRange(transaction.date))
    .filter((transaction) => side === 'All' || transactionSide(transaction.isBuy) === side)
    .filter((transaction) =>
      search === ''
        ? true
        : `${transaction.typeName} ${transaction.locationName ?? ''}`
            .toLocaleLowerCase('en-US')
            .includes(search),
    )
})
const activeOrders = computed(() =>
  orderMode.value === 'open'
    ? (openOrders.value?.orders ?? [])
    : (orderHistory.value?.orders ?? []).filter((order) => withinRange(order.issuedAt)),
)
const filteredOrders = computed(() => {
  const filter = orderFilter.value
  return activeOrders.value.filter((order) => {
    if (filter === 'All') return true
    if (filter === 'Escrowed') return (order.escrow ?? 0) > 0
    return orderSide(order.isBuy) === filter.toLocaleLowerCase('en-US')
  })
})
const filteredContracts = computed(() => {
  const filter = contractFilter.value
  return (contracts.value?.contracts ?? [])
    .filter((contract) => withinRange(contract.issuedAt))
    .filter((contract) => {
      if (filter === 'All') return true
      if (filter === 'Awaiting me') return contractAwaitsCharacter(contract)
      if (filter === 'Active')
        return contract.status === 'outstanding' || contract.status === 'in_progress'
      if (filter === 'Couriers') return contract.type === 'courier'
      if (filter === 'Auctions') return contract.type === 'auction'
      return closedContractStatuses.has(contract.status)
    })
})

const escrowOrders = computed(() =>
  (openOrders.value?.orders ?? []).filter((order) => (order.escrow ?? 0) > 0),
)
const escrowTotal = computed(() =>
  escrowOrders.value.reduce((total, order) => total + (order.escrow ?? 0), 0),
)
const awaitingContracts = computed(
  () =>
    (contracts.value?.contracts ?? []).filter((contract) => contractAwaitsCharacter(contract))
      .length,
)
const expiringOrders = computed(
  () =>
    (openOrders.value?.orders ?? []).filter((order) => expiresWithin48Hours(order.expiresAt))
      .length,
)
const expiringContracts = computed(
  () =>
    (contracts.value?.contracts ?? []).filter(
      (contract) =>
        expiresWithin48Hours(contract.expiredAt) &&
        (contract.status === 'outstanding' || contract.status === 'in_progress'),
    ).length,
)
const expiringTotal = computed(() => expiringOrders.value + expiringContracts.value)
const netInRange = computed(() =>
  rangedJournal.value.reduce((total, entry) => total + (entry.amount ?? 0), 0),
)

const heroMetrics = computed(() => {
  const metrics: Array<{
    id: string
    label: string
    detail: string
    value: string
    link?: boolean
  }> = []
  if (journal.value && netInRange.value !== 0)
    metrics.push({
      id: 'net',
      label: 'Net change',
      detail: `${rangedJournal.value.length} journal entries · loaded page`,
      value: `${formatSignedIsk(netInRange.value)} ISK`,
    })
  if (openOrders.value && escrowTotal.value > 0)
    metrics.push({
      id: 'escrow',
      label: 'In escrow',
      detail: `${escrowOrders.value.length} buy orders · complete collection`,
      value: `${formatIsk(escrowTotal.value, 0)} ISK`,
    })
  if (contracts.value && awaitingContracts.value > 0)
    metrics.push({
      id: 'awaiting',
      label: 'Awaiting me',
      detail: 'contracts assigned to you · loaded page',
      value: String(awaitingContracts.value),
      link: true,
    })
  if (expiringTotal.value > 0)
    metrics.push({
      id: 'expiring',
      label: 'Expiring < 48h',
      detail: `${expiringOrders.value} orders · ${expiringContracts.value} contracts`,
      value: String(expiringTotal.value),
    })
  return metrics
})

const ledgerTabs = computed(() => [
  { value: 'journal' as const, label: 'Journal' },
  { value: 'transactions' as const, label: 'Transactions' },
  { value: 'orders' as const, label: 'Orders' },
  { value: 'contracts' as const, label: 'Contracts' },
])
const selectedLedgerTab = computed({
  get: () => activeTab.value,
  set: (tab: string) => selectTab(tab as LedgerTab),
})

const journalGroupChips = ['All', 'Income', 'Expense', 'Market', 'Contracts']
const transactionSideChips = ['All', 'Buy', 'Sell']
const orderChips = ['All', 'Buy', 'Sell', 'Escrowed']
const contractChips = ['All', 'Awaiting me', 'Active', 'Couriers', 'Auctions', 'Closed']
const ledgerRanges: LedgerRange[] = ['7D', '30D', '90D', 'ALL']
const closedContractStatuses = new Set([
  'cancelled',
  'deleted',
  'failed',
  'finished',
  'finished_contractor',
  'finished_issuer',
  'rejected',
  'reversed',
])
const rangeDays: Record<LedgerRange, number> = {
  '7D': 7,
  '30D': 30,
  '90D': 90,
  ALL: Number.POSITIVE_INFINITY,
}

watch(selectedContractId, (contractId) => {
  const contract = selectedContract.value
  if (contractId === undefined || !contract) return
  if (contractHasItems(contract.type))
    requestedItemPages.value = new Map(requestedItemPages.value).set(contractId, contractPage.value)
  if (contract.type === 'auction')
    requestedBidPages.value = new Map(requestedBidPages.value).set(contractId, contractPage.value)
})

// Activating a tab is the request for its private resource; nothing loads before that.
function selectTab(tab: LedgerTab) {
  activeTab.value = tab
  if (tab === 'transactions') transactionsRequested.value = true
  if (tab === 'orders') openOrdersRequested.value = true
  if (tab === 'contracts') contractsRequested.value = true
}

function ledgerTabBadge(tab: string) {
  if (tab === 'orders' && openOrders.value) return expiringOrders.value
  if (tab === 'contracts' && contracts.value) return awaitingContracts.value
  return 0
}

function reviewAwaitingContracts() {
  selectTab('contracts')
  contractFilter.value = 'Awaiting me'
}

function showContractsInJournal() {
  closeContractDrawer()
  selectTab('journal')
  journalGroupFilter.value = 'Contracts'
}

function selectRange(next: LedgerRange) {
  range.value = next
}

function selectOrderMode(mode: 'open' | 'history') {
  orderMode.value = mode
  if (mode === 'history') orderHistoryRequested.value = true
  orderFilter.value = 'All'
}

function changePage(
  resource: 'contracts' | 'journal' | 'order-history',
  nextPage: number,
  onChange?: () => void,
) {
  if (!Number.isSafeInteger(nextPage) || nextPage < 1) return
  onChange?.()
  if (resource === 'journal') journalPage.value = nextPage
  if (resource === 'order-history') orderHistoryPage.value = nextPage
  if (resource === 'contracts') contractPage.value = nextPage
}

function loadOlderTransactions() {
  const nextFromId = transactions.value?.nextFromId
  if (nextFromId === null || nextFromId === undefined) return
  transactionContinuations.value = [
    ...transactionContinuations.value.slice(0, transactionRangeIndex.value + 1),
    nextFromId,
  ]
  transactionRangeIndex.value += 1
}

function showNewerTransactions() {
  if (transactionRangeIndex.value > 0) transactionRangeIndex.value -= 1
}

function openContractDrawer(contractId: number, event: MouseEvent | KeyboardEvent) {
  contractTrigger.value = event.currentTarget as HTMLElement
  selectedContractId.value = contractId
}

function closeContractDrawer(restoreFocus = true) {
  const trigger = contractTrigger.value
  selectedContractId.value = undefined
  contractTrigger.value = undefined
  if (restoreFocus) void nextTick(() => trigger?.focus())
}

function refreshRequestedFinance() {
  void balanceQuery.refetch()
  if (journalRequested.value) void journalQuery.refetch()
  if (transactionsRequested.value) void transactionQuery.refetch()
  if (openOrdersRequested.value) void openOrdersQuery.refetch()
  if (orderHistoryRequested.value) void orderHistoryQuery.refetch()
  if (contractsRequested.value) void contractsQuery.refetch()

  for (const [contractId, openedOnPage] of requestedItemPages.value) {
    void prefetchQuery(
      queryCache,
      characterFinanceContractItemsQuery({
        apiClient,
        characterId: characterId.value ?? 0,
        access: financeAccess.value,
        requested: true,
        contractId,
        contractPage: openedOnPage,
      }),
    )
  }
  for (const [contractId, openedOnPage] of requestedBidPages.value) {
    void prefetchQuery(
      queryCache,
      characterFinanceContractBidsQuery({
        apiClient,
        characterId: characterId.value ?? 0,
        access: financeAccess.value,
        requested: true,
        contractId,
        contractPage: openedOnPage,
      }),
    )
  }
}

function contractHasItems(type: string) {
  return type === 'auction' || type === 'courier' || type === 'item_exchange'
}

function contractAwaitsCharacter(contract: { role: 'assigned' | 'issued'; status: string }) {
  return (
    contract.role === 'assigned' &&
    (contract.status === 'outstanding' || contract.status === 'in_progress')
  )
}

function journalGroup(referenceType: string) {
  if (referenceType.includes('contract')) return 'Contracts'
  if (
    referenceType.includes('market') ||
    referenceType.includes('broker') ||
    referenceType.includes('transaction_tax')
  )
    return 'Market'
  return 'Other'
}

function withinRange(value: string) {
  if (currentTime.value === 0) return true
  const days = rangeDays[range.value]
  if (days === Number.POSITIVE_INFINITY) return true
  const elapsed = currentTime.value - Date.parse(value)
  return Number.isNaN(elapsed) || elapsed <= days * 86_400_000
}

function expiresWithin48Hours(value: string) {
  if (currentTime.value === 0) return false
  const remaining = Date.parse(value) - currentTime.value
  return remaining > 0 && remaining <= 48 * 3_600_000
}

function queryError(value: unknown) {
  return value instanceof Error ? value : null
}

function financeErrorMessage(error: Error | null) {
  if (!error) return ''
  return error instanceof ApiQueryError &&
    error.status === 429 &&
    error.retryAfterSeconds !== undefined
    ? `${error.message} Retry after ${error.retryAfterSeconds} seconds.`
    : error.message
}

function isScopeError(error: Error | null) {
  return (
    error instanceof ApiQueryError &&
    (error.code === 'EVE_SCOPE_REQUIRED' || error.code === 'EVE_REAUTH_REQUIRED')
  )
}

function orderSide(value: boolean) {
  return value ? 'buy' : 'sell'
}

function transactionSide(isBuy: boolean) {
  return isBuy ? 'Buy' : 'Sell'
}

function orderStateLabel(order: OpenOrder | OrderHistoryEntry) {
  return 'state' in order ? order.state.toLocaleUpperCase('en-US') : '—'
}

function orderFill(order: { volumeRemain: number; volumeTotal: number }) {
  if (order.volumeTotal <= 0) return 0
  return Math.round(((order.volumeTotal - order.volumeRemain) / order.volumeTotal) * 100)
}

function formatIsk(value: number, fractionDigits = 2) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(value)
}

function formatSignedIsk(value: number | null) {
  if (value === null) return 'UNAVAILABLE'
  return `${value > 0 ? '+' : ''}${formatIsk(value)}`
}

function formatDate(value: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
    year: 'numeric',
  }).formatToParts(new Date(value))
  const lookup = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'
  return `${lookup('year')}.${lookup('month')}.${lookup('day')} ${lookup('hour')}:${lookup('minute')}`
}

function formatCountdown(value: string) {
  if (currentTime.value === 0) return '—'
  const remaining = Date.parse(value) - currentTime.value
  if (Number.isNaN(remaining)) return '—'
  if (remaining <= 0) return 'ELAPSED'
  const hours = Math.floor(remaining / 3_600_000)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

function formatSynced(value: string | undefined) {
  if (!value || currentTime.value === 0) return '—'
  const elapsed = currentTime.value - Date.parse(value)
  if (Number.isNaN(elapsed)) return '—'
  if (elapsed < 60_000) return 'JUST NOW'
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 60) return `${minutes}M AGO`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}H AGO` : `${Math.floor(hours / 24)}D AGO`
}

function formatContractType(value: string) {
  return value.replaceAll('_', ' ').toLocaleUpperCase('en-US')
}

function financeTerm(value: number | null) {
  return value === null ? '—' : `${formatIsk(value, 0)} ISK`
}

function contractValue(contract: { price: number | null; reward: number | null }) {
  return financeTerm(contract.price ?? contract.reward)
}

function pageLabel(shown: number, total: number, scope: string) {
  return `${shown} OF ${total} ${scope}`
}

useCharacterReauthorization(characterId, refreshRequestedFinance)
</script>

<template>
  <section class="character-finance-route" aria-label="Character finance">
    <CharacterSummaryCard>
      <template #icon>
        <UiEveImage kind="type-icon" :id="52996" :dimension="42" alt="" aria-hidden="true" />
      </template>
      <template #eyebrow>CHARACTER WALLET</template>
      <template #value>{{ formattedBalance }} ISK</template>
      <template #label>AUTHORIZED BALANCE / COMPLETE VALUE</template>

      <dl v-if="heroMetrics.length > 0" class="finance-hero-metrics">
        <div v-for="metric in heroMetrics" :key="metric.id">
          <dt>
            {{ metric.label }}
            <span>{{ metric.detail }}</span>
          </dt>
          <dd>
            <button
              v-if="metric.link"
              class="finance-hero-link"
              type="button"
              @click="reviewAwaitingContracts"
            >
              {{ metric.value }}
            </button>
            <template v-else>{{ metric.value }}</template>
          </dd>
        </div>
      </dl>

      <div class="finance-hero-actions">
        <a
          v-if="
            balanceScopeRequired &&
            balanceError instanceof ApiQueryError &&
            balanceError.authorizeUrl
          "
          class="ui-action-primary"
          :href="balanceError.authorizeUrl"
        >
          AUTHORIZE WALLET
        </a>
        <button
          v-else
          class="ui-action-secondary"
          type="button"
          :disabled="balanceQuery.asyncStatus.value === 'loading'"
          @click="balanceQuery.refetch()"
        >
          {{ balanceQuery.asyncStatus.value === 'loading' ? 'REFRESHING...' : 'REFRESH BALANCE' }}
        </button>
        <span v-if="balance?.validatedAt" class="finance-synced">
          SYNCED {{ formatSynced(balance.validatedAt) }}
        </span>
      </div>
    </CharacterSummaryCard>

    <output v-if="balance?.stale" class="finance-stale-notice">
      The current wallet balance is retained stale data.
    </output>
    <p v-if="balanceError && !balance" class="finance-inline-error" role="alert">
      {{ balanceMessage }}
    </p>

    <section class="finance-ledger" aria-labelledby="finance-ledger-title">
      <header class="finance-ledger-header">
        <h2 id="finance-ledger-title">Finance ledger</h2>
        <div class="finance-range">
          <span class="finance-range-label">Range</span>
          <fieldset class="finance-range-options">
            <legend class="sr-only">Loaded data range</legend>
            <button
              v-for="option in ledgerRanges"
              :key="option"
              type="button"
              :data-state="range === option ? 'active' : 'inactive'"
              :aria-pressed="range === option"
              @click="selectRange(option)"
            >
              {{ option }}
            </button>
          </fieldset>
        </div>
      </header>

      <UiTabs
        v-model="selectedLedgerTab"
        aria-label="Finance services"
        content-class="finance-tab-panel"
        list-class="finance-tabs"
        :tabs="ledgerTabs"
        unmount-on-hide
      >
        <template #trigger="slotProps">
          {{ slotProps?.tab.label }}
          <span v-if="ledgerTabBadge(slotProps?.tab.value ?? '') > 0" class="finance-tab-badge">
            {{ ledgerTabBadge(slotProps?.tab.value ?? '') }}
          </span>
        </template>

        <template #journal>
          <div class="finance-service-body">
            <CharacterFinanceServicePanel
              :error="queryError(journalQuery.error.value)"
              :has-data="Boolean(journal)"
              :loading="journalQuery.asyncStatus.value === 'loading'"
              :stale="journal?.stale"
              title="Wallet journal"
              :validated-at="journal?.validatedAt"
              @retry="journalQuery.refetch()"
            >
              <div class="finance-toolbar">
                <span class="finance-toolbar-label">Ref type</span>
                <button
                  v-for="chip in journalGroupChips"
                  :key="chip"
                  class="finance-chip"
                  type="button"
                  :data-state="journalGroupFilter === chip ? 'active' : 'inactive'"
                  :aria-pressed="journalGroupFilter === chip"
                  @click="journalGroupFilter = chip"
                >
                  {{ chip }}
                </button>
                <span class="finance-toolbar-note">esi-wallet.read_character_wallet.v1</span>
              </div>
              <output class="sr-only" aria-live="polite">
                {{
                  pageLabel(
                    filteredJournal.length,
                    journal?.entries.length ?? 0,
                    'on the loaded page',
                  )
                }}
              </output>
              <UiStatePanel
                v-if="filteredJournal.length === 0"
                code="NO ENTRIES"
                title="Journal page empty"
                compact
                role="status"
              >
                <p>No journal entries on the loaded page match this range and filter.</p>
              </UiStatePanel>
              <div v-else class="finance-table-scroll">
                <table class="finance-table finance-table--journal">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Ref type</th>
                      <th scope="col">Description</th>
                      <th scope="col" class="is-numeric">Amount</th>
                      <th scope="col" class="is-numeric">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="entry in filteredJournal" :key="entry.journalId">
                      <td class="is-mono">{{ formatDate(entry.date) }}</td>
                      <td>{{ formatContractType(entry.referenceType) }}</td>
                      <td class="is-truncated">{{ entry.description }}</td>
                      <td
                        class="is-numeric is-mono"
                        :class="(entry.amount ?? 0) > 0 ? 'is-income' : 'is-expense'"
                      >
                        {{ formatSignedIsk(entry.amount) }}
                      </td>
                      <td class="is-numeric is-mono is-subtle">
                        {{ entry.balance === null ? 'UNAVAILABLE' : formatIsk(entry.balance) }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="finance-table-footer">
                <span class="finance-footer-scope">
                  {{
                    pageLabel(
                      filteredJournal.length,
                      journal?.entries.length ?? 0,
                      'on the loaded page',
                    )
                  }}
                  · PAGE {{ journal?.page }} / {{ journal?.totalPages }} · SYNCED
                  {{ formatSynced(journal?.validatedAt) }}
                </span>
                <div class="finance-footer-actions">
                  <button
                    class="finance-ghost-button"
                    type="button"
                    :disabled="journalQuery.asyncStatus.value === 'loading'"
                    @click="journalQuery.refetch()"
                  >
                    REFRESH
                  </button>
                  <button
                    class="finance-ghost-button"
                    type="button"
                    :disabled="journalPage <= 1 || journalQuery.asyncStatus.value === 'loading'"
                    @click="changePage('journal', journalPage - 1)"
                  >
                    PREV
                  </button>
                  <button
                    class="finance-ghost-button"
                    type="button"
                    :disabled="
                      journalPage >= (journal?.totalPages ?? 1) ||
                      journalQuery.asyncStatus.value === 'loading'
                    "
                    @click="changePage('journal', journalPage + 1)"
                  >
                    NEXT
                  </button>
                </div>
              </div>
            </CharacterFinanceServicePanel>
          </div>
        </template>

        <template #transactions>
          <div class="finance-service-body">
            <CharacterFinanceServicePanel
              :error="queryError(transactionQuery.error.value)"
              :has-data="Boolean(transactions)"
              :loading="transactionQuery.asyncStatus.value === 'loading'"
              :stale="transactions?.stale"
              title="Market transactions"
              :validated-at="transactions?.validatedAt"
              @retry="transactionQuery.refetch()"
            >
              <div class="finance-toolbar">
                <button
                  v-for="chip in transactionSideChips"
                  :key="chip"
                  class="finance-chip"
                  type="button"
                  :data-state="transactionSideFilter === chip ? 'active' : 'inactive'"
                  :aria-pressed="transactionSideFilter === chip"
                  @click="transactionSideFilter = chip"
                >
                  {{ chip }}
                </button>
                <label class="finance-search">
                  <span class="sr-only">Filter the loaded transaction range</span>
                  <input
                    v-model="transactionQueryFilter"
                    type="search"
                    placeholder="Filter by item or station"
                  />
                </label>
              </div>
              <UiStatePanel
                v-if="filteredTransactions.length === 0"
                code="NO ACTIVITY"
                title="Transaction range empty"
                compact
                role="status"
              >
                <p>No personal transactions in this loaded range match the filters.</p>
              </UiStatePanel>
              <div v-else class="finance-table-scroll">
                <table class="finance-table finance-table--transactions">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Side</th>
                      <th scope="col">Item</th>
                      <th scope="col" class="is-numeric">Qty</th>
                      <th scope="col" class="is-numeric">Unit price</th>
                      <th scope="col" class="is-numeric">Total</th>
                      <th scope="col">Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="transaction in filteredTransactions"
                      :key="transaction.transactionId"
                    >
                      <td class="is-mono">{{ formatDate(transaction.date) }}</td>
                      <td>
                        <span
                          class="finance-side"
                          :class="transaction.isBuy ? 'is-buy' : 'is-sell'"
                        >
                          {{ transaction.isBuy ? 'BUY' : 'SELL' }}
                        </span>
                      </td>
                      <td class="is-truncated">
                        <CharacterFinanceItemIdentity
                          :name="transaction.typeName"
                          :type-id="transaction.typeId"
                        />
                      </td>
                      <td class="is-numeric is-mono is-subtle">
                        {{ transaction.quantity.toLocaleString('en-US') }}
                      </td>
                      <td class="is-numeric is-mono is-subtle">
                        {{ formatIsk(transaction.unitPrice) }}
                      </td>
                      <td
                        class="is-numeric is-mono"
                        :class="transaction.isBuy ? 'is-expense' : 'is-income'"
                      >
                        {{ transaction.isBuy ? '-' : '+' }}{{ formatIsk(transaction.totalPrice) }}
                      </td>
                      <td class="is-truncated is-subtle">
                        {{ transaction.locationName ?? `Location ${transaction.locationId}` }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="finance-table-footer">
                <span class="finance-footer-scope">
                  {{
                    pageLabel(
                      filteredTransactions.length,
                      transactions?.transactions.length ?? 0,
                      'in the loaded range',
                    )
                  }}
                  · RANGE {{ transactionRangeIndex + 1 }} · SYNCED
                  {{ formatSynced(transactions?.validatedAt) }}
                </span>
                <div class="finance-footer-actions">
                  <button
                    class="finance-ghost-button"
                    type="button"
                    :disabled="transactionQuery.asyncStatus.value === 'loading'"
                    @click="transactionQuery.refetch()"
                  >
                    REFRESH
                  </button>
                  <button
                    class="finance-ghost-button"
                    type="button"
                    :disabled="
                      transactionRangeIndex === 0 ||
                      transactionQuery.asyncStatus.value === 'loading'
                    "
                    @click="showNewerTransactions"
                  >
                    NEWER
                  </button>
                  <button
                    class="finance-ghost-button"
                    type="button"
                    :disabled="
                      transactions?.nextFromId === null ||
                      transactionQuery.asyncStatus.value === 'loading'
                    "
                    @click="loadOlderTransactions"
                  >
                    OLDER
                  </button>
                </div>
              </div>
            </CharacterFinanceServicePanel>
          </div>
        </template>

        <template #orders>
          <div class="finance-service-body">
            <CharacterFinanceServicePanel
              :error="
                queryError(
                  orderMode === 'open'
                    ? openOrdersQuery.error.value
                    : orderHistoryQuery.error.value,
                )
              "
              :has-data="Boolean(orderMode === 'open' ? openOrders : orderHistory)"
              :loading="
                orderMode === 'open'
                  ? openOrdersQuery.asyncStatus.value === 'loading'
                  : orderHistoryQuery.asyncStatus.value === 'loading'
              "
              :stale="orderMode === 'open' ? openOrders?.stale : orderHistory?.stale"
              title="Market orders"
              @retry="
                orderMode === 'open' ? openOrdersQuery.refetch() : orderHistoryQuery.refetch()
              "
            >
              <div class="finance-toolbar">
                <fieldset class="finance-mode">
                  <legend class="sr-only">Order collection</legend>
                  <button
                    type="button"
                    :data-state="orderMode === 'open' ? 'active' : 'inactive'"
                    :aria-pressed="orderMode === 'open'"
                    @click="selectOrderMode('open')"
                  >
                    Open orders
                  </button>
                  <button
                    type="button"
                    :data-state="orderMode === 'history' ? 'active' : 'inactive'"
                    :aria-pressed="orderMode === 'history'"
                    @click="selectOrderMode('history')"
                  >
                    Order history
                  </button>
                </fieldset>
                <button
                  v-for="chip in orderChips"
                  :key="chip"
                  class="finance-chip"
                  type="button"
                  :data-state="orderFilter === chip ? 'active' : 'inactive'"
                  :aria-pressed="orderFilter === chip"
                  @click="orderFilter = chip"
                >
                  {{ chip }}
                </button>
                <span class="finance-toolbar-note">
                  Personal orders only · corporation orders excluded
                </span>
              </div>
              <UiStatePanel
                v-if="filteredOrders.length === 0"
                code="NO ORDERS"
                :title="orderMode === 'open' ? 'No open orders' : 'History page empty'"
                compact
                role="status"
              >
                <p>No personal market orders match this range and filter.</p>
              </UiStatePanel>
              <div v-else class="finance-table-scroll">
                <table class="finance-table finance-table--orders">
                  <thead>
                    <tr>
                      <th scope="col">Side</th>
                      <th scope="col">Item</th>
                      <th scope="col" class="is-numeric">Price</th>
                      <th scope="col">{{ orderMode === 'open' ? 'Remaining' : 'Traded' }}</th>
                      <th scope="col">Range</th>
                      <th scope="col">Location</th>
                      <th scope="col" class="is-numeric">Escrow</th>
                      <th scope="col" class="is-numeric">
                        {{ orderMode === 'open' ? 'Expires' : 'State' }}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="order in filteredOrders" :key="order.orderId">
                      <td>
                        <span class="finance-side" :class="`is-${orderSide(order.isBuy)}`">
                          {{ orderSide(order.isBuy).toLocaleUpperCase('en-US') }}
                        </span>
                      </td>
                      <td class="is-truncated">
                        <CharacterFinanceItemIdentity
                          :name="order.typeName"
                          :type-id="order.typeId"
                        />
                      </td>
                      <td class="is-numeric is-mono">{{ formatIsk(order.price) }}</td>
                      <td>
                        <span class="finance-volume">
                          {{ order.volumeRemain.toLocaleString('en-US') }} /
                          {{ order.volumeTotal.toLocaleString('en-US') }}
                        </span>
                        <span class="finance-fill" aria-hidden="true">
                          <span
                            class="finance-fill-bar"
                            :class="`is-${orderSide(order.isBuy)}`"
                            :style="{ width: `${orderFill(order)}%` }"
                          />
                        </span>
                      </td>
                      <td class="is-subtle is-capitalized">{{ order.range }}</td>
                      <td class="is-truncated is-subtle">
                        {{ order.locationName ?? `Location ${order.locationId}` }}
                      </td>
                      <td class="is-numeric is-mono is-subtle">{{ financeTerm(order.escrow) }}</td>
                      <td class="is-numeric is-mono">
                        <template v-if="orderMode === 'open'">
                          <time
                            :datetime="order.expiresAt"
                            :class="
                              expiresWithin48Hours(order.expiresAt) ? 'is-urgent' : 'is-subtle'
                            "
                          >
                            {{ formatCountdown(order.expiresAt) }}
                          </time>
                        </template>
                        <span v-else class="is-subtle">{{ orderStateLabel(order) }}</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="finance-table-footer">
                <span class="finance-footer-scope">
                  {{
                    pageLabel(
                      filteredOrders.length,
                      activeOrders.length,
                      orderMode === 'open' ? 'in the complete collection' : 'on the loaded page',
                    )
                  }}
                  · SYNCED
                  {{
                    formatSynced(
                      orderMode === 'open' ? openOrders?.validatedAt : orderHistory?.validatedAt,
                    )
                  }}
                </span>
                <div v-if="orderMode === 'history'" class="finance-footer-actions">
                  <button
                    class="finance-ghost-button"
                    type="button"
                    :disabled="orderHistoryQuery.asyncStatus.value === 'loading'"
                    @click="orderHistoryQuery.refetch()"
                  >
                    REFRESH
                  </button>
                  <button
                    class="finance-ghost-button"
                    type="button"
                    :disabled="
                      orderHistoryPage <= 1 || orderHistoryQuery.asyncStatus.value === 'loading'
                    "
                    @click="changePage('order-history', orderHistoryPage - 1)"
                  >
                    PREV
                  </button>
                  <button
                    class="finance-ghost-button"
                    type="button"
                    :disabled="
                      orderHistoryPage >= (orderHistory?.totalPages ?? 1) ||
                      orderHistoryQuery.asyncStatus.value === 'loading'
                    "
                    @click="changePage('order-history', orderHistoryPage + 1)"
                  >
                    NEXT
                  </button>
                </div>
                <div v-else class="finance-footer-actions">
                  <button
                    class="finance-ghost-button"
                    type="button"
                    :disabled="openOrdersQuery.asyncStatus.value === 'loading'"
                    @click="openOrdersQuery.refetch()"
                  >
                    REFRESH
                  </button>
                </div>
              </div>
            </CharacterFinanceServicePanel>
          </div>
        </template>

        <template #contracts>
          <div class="finance-service-body">
            <CharacterFinanceServicePanel
              :error="queryError(contractsQuery.error.value)"
              :has-data="Boolean(contracts)"
              :loading="contractsQuery.asyncStatus.value === 'loading'"
              :stale="contracts?.stale"
              title="Character contracts"
              :validated-at="contracts?.validatedAt"
              @retry="contractsQuery.refetch()"
            >
              <div class="finance-toolbar">
                <button
                  v-for="chip in contractChips"
                  :key="chip"
                  class="finance-chip"
                  type="button"
                  :data-state="contractFilter === chip ? 'active' : 'inactive'"
                  :aria-pressed="contractFilter === chip"
                  @click="contractFilter = chip"
                >
                  {{ chip }}
                </button>
                <span class="finance-toolbar-note">Issued by or assigned to this character</span>
              </div>
              <UiStatePanel
                v-if="filteredContracts.length === 0"
                code="NO CONTRACTS"
                title="Contract page empty"
                compact
                role="status"
              >
                <p>No personal contracts on the loaded page match this range and filter.</p>
              </UiStatePanel>
              <div v-else class="finance-table-scroll">
                <table class="finance-table finance-table--contracts">
                  <thead>
                    <tr>
                      <th scope="col">Type</th>
                      <th scope="col">Title</th>
                      <th scope="col">Status</th>
                      <th scope="col" class="is-numeric">Value</th>
                      <th scope="col" class="is-numeric">Collateral</th>
                      <th scope="col" class="is-numeric">Volume</th>
                      <th scope="col" class="is-numeric">Expires</th>
                      <th scope="col"><span class="sr-only">Open details</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="contract in filteredContracts"
                      :key="contract.contractId"
                      class="finance-contract-row"
                      :data-state="
                        selectedContractId === contract.contractId ? 'active' : 'inactive'
                      "
                    >
                      <td class="is-mono is-subtle">{{ formatContractType(contract.type) }}</td>
                      <td class="is-truncated">
                        {{ contract.title || `Contract ${contract.contractId}` }}
                      </td>
                      <td class="is-mono" :class="`is-status-${contract.status}`">
                        {{ formatContractType(contract.status) }}
                      </td>
                      <td class="is-numeric is-mono">{{ contractValue(contract) }}</td>
                      <td class="is-numeric is-mono is-subtle">
                        {{ financeTerm(contract.collateral) }}
                      </td>
                      <td class="is-numeric is-mono is-subtle">
                        {{
                          contract.volume === null
                            ? '—'
                            : `${contract.volume.toLocaleString('en-US')} m³`
                        }}
                      </td>
                      <td
                        class="is-numeric is-mono"
                        :class="
                          expiresWithin48Hours(contract.expiredAt) ? 'is-urgent' : 'is-subtle'
                        "
                      >
                        {{ formatCountdown(contract.expiredAt) }}
                      </td>
                      <td class="is-numeric">
                        <button
                          class="finance-open-details"
                          type="button"
                          :aria-expanded="selectedContractId === contract.contractId"
                          :aria-label="`Open details for ${contract.title || `contract ${contract.contractId}`}`"
                          @click="openContractDrawer(contract.contractId, $event)"
                        >
                          ›
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="finance-table-footer">
                <span class="finance-footer-scope">
                  {{
                    pageLabel(
                      filteredContracts.length,
                      contracts?.contracts.length ?? 0,
                      'on the loaded page',
                    )
                  }}
                  · PAGE {{ contracts?.page }} / {{ contracts?.totalPages }} · SYNCED
                  {{ formatSynced(contracts?.validatedAt) }}
                </span>
                <div class="finance-footer-actions">
                  <button
                    class="finance-ghost-button"
                    type="button"
                    :disabled="contractsQuery.asyncStatus.value === 'loading'"
                    @click="contractsQuery.refetch()"
                  >
                    REFRESH
                  </button>
                  <button
                    class="finance-ghost-button"
                    type="button"
                    :disabled="contractPage <= 1 || contractsQuery.asyncStatus.value === 'loading'"
                    @click="
                      changePage('contracts', contractPage - 1, () => closeContractDrawer(false))
                    "
                  >
                    PREV
                  </button>
                  <button
                    class="finance-ghost-button"
                    type="button"
                    :disabled="
                      contractPage >= (contracts?.totalPages ?? 1) ||
                      contractsQuery.asyncStatus.value === 'loading'
                    "
                    @click="
                      changePage('contracts', contractPage + 1, () => closeContractDrawer(false))
                    "
                  >
                    NEXT
                  </button>
                </div>
              </div>
            </CharacterFinanceServicePanel>
          </div>
        </template>
      </UiTabs>
    </section>

    <UiDrawer
      v-model:open="contractDrawerOpen"
      close-label="Close contract details"
      content-class="finance-drawer"
      description="Review the selected character contract terms, items, and bids"
      side="right"
      :title="
        selectedContract?.title ||
        (selectedContract ? formatContractType(selectedContract.type) : 'Contract details')
      "
    >
      <template v-if="selectedContract">
        <div class="finance-drawer-body">
          <header class="finance-drawer-heading">
            <p class="ui-eyebrow">
              {{ formatContractType(selectedContract.type) }} ·
              {{ formatContractType(selectedContract.status) }}
            </p>
            <h2>
              {{ selectedContract.title || formatContractType(selectedContract.type) }}
            </h2>
            <span class="finance-drawer-id">CONTRACT {{ selectedContract.contractId }}</span>
          </header>

          <dl class="finance-drawer-meta">
            <div>
              <dt>{{ selectedContract.price === null ? 'Reward' : 'Price' }}</dt>
              <dd>{{ contractValue(selectedContract) }}</dd>
            </div>
            <div>
              <dt>Collateral</dt>
              <dd :class="{ 'is-urgent': (selectedContract.collateral ?? 0) > 0 }">
                {{ financeTerm(selectedContract.collateral) }}
              </dd>
            </div>
            <div>
              <dt>Volume</dt>
              <dd>
                {{
                  selectedContract.volume === null
                    ? '—'
                    : `${selectedContract.volume.toLocaleString('en-US')} m³`
                }}
              </dd>
            </div>
            <div>
              <dt>Availability</dt>
              <dd>{{ formatContractType(selectedContract.availability) }}</dd>
            </div>
            <div>
              <dt>Issued</dt>
              <dd>{{ formatDate(selectedContract.issuedAt) }}</dd>
            </div>
            <div>
              <dt>{{ selectedContract.daysToComplete ? 'Days to complete' : 'Expires' }}</dt>
              <dd>
                {{
                  selectedContract.daysToComplete
                    ? `${selectedContract.daysToComplete} days`
                    : formatCountdown(selectedContract.expiredAt)
                }}
              </dd>
            </div>
          </dl>

          <section v-if="contractHasItems(selectedContract.type)" class="finance-drawer-section">
            <header>
              <span class="finance-drawer-section-label">Items</span>
              <span class="finance-drawer-section-note">FETCHED ON OPEN</span>
            </header>
            <UiStatePanel
              v-if="contractItemsQuery.asyncStatus.value === 'loading' && !contractItems"
              compact
              role="status"
            >
              <p>Loading contract items...</p>
            </UiStatePanel>
            <UiStatePanel
              v-else-if="contractItemsError && !contractItems"
              code="ERR / ITEMS"
              title="Contract items unavailable"
              compact
              role="alert"
              tone="error"
            >
              <p>{{ financeErrorMessage(contractItemsError) }}</p>
              <template #action>
                <a
                  v-if="
                    contractItemsError instanceof ApiQueryError && contractItemsError.authorizeUrl
                  "
                  class="ui-action-primary"
                  :href="contractItemsError.authorizeUrl"
                >
                  AUTHORIZE THIS CHARACTER
                </a>
                <button
                  v-else
                  class="ui-action-secondary"
                  type="button"
                  @click="contractItemsQuery.refetch()"
                >
                  RETRY
                </button>
              </template>
            </UiStatePanel>
            <p
              v-else-if="contractItems && contractItems.items.length === 0"
              class="finance-drawer-empty"
            >
              No item records apply to this contract.
            </p>
            <ul v-else-if="contractItems" class="finance-drawer-list">
              <li v-for="item in contractItems.items" :key="item.recordId">
                <span class="finance-drawer-direction" :class="`is-${item.direction}`">
                  {{ item.direction.toLocaleUpperCase('en-US') }}
                </span>
                <CharacterFinanceItemIdentity :name="item.typeName" :type-id="item.typeId" />
                <span class="finance-drawer-quantity">
                  ×{{ item.quantity.toLocaleString('en-US') }}
                </span>
              </li>
            </ul>
          </section>

          <section v-if="selectedContract.type === 'auction'" class="finance-drawer-section">
            <header>
              <span class="finance-drawer-section-label">Bids</span>
              <span class="finance-drawer-section-note">FETCHED ON OPEN</span>
            </header>
            <UiStatePanel
              v-if="contractBidsQuery.asyncStatus.value === 'loading' && !contractBids"
              compact
              role="status"
            >
              <p>Loading auction bids...</p>
            </UiStatePanel>
            <UiStatePanel
              v-else-if="contractBidsError && !contractBids"
              code="ERR / BIDS"
              title="Auction bids unavailable"
              compact
              role="alert"
              tone="error"
            >
              <p>{{ financeErrorMessage(contractBidsError) }}</p>
              <template #action>
                <button
                  class="ui-action-secondary"
                  type="button"
                  @click="contractBidsQuery.refetch()"
                >
                  RETRY
                </button>
              </template>
            </UiStatePanel>
            <p
              v-else-if="contractBids && contractBids.bids.length === 0"
              class="finance-drawer-empty"
            >
              No bids have been placed on this auction.
            </p>
            <ul v-else-if="contractBids" class="finance-drawer-list">
              <li v-for="bid in contractBids.bids" :key="bid.bidId">
                <time :datetime="bid.bidAt" class="is-subtle">{{ formatDate(bid.bidAt) }}</time>
                <span class="finance-drawer-quantity">{{ formatIsk(bid.amount, 0) }} ISK</span>
              </li>
            </ul>
            <p class="finance-drawer-footnote">
              Bidder identities are not shown — only your own character's financial position is
              exposed here.
            </p>
          </section>

          <div class="finance-drawer-actions">
            <button class="ui-action-secondary" type="button" @click="showContractsInJournal">
              SHOW IN JOURNAL
            </button>
          </div>
        </div>
      </template>
    </UiDrawer>
  </section>
</template>

<style>
@import url('~/assets/css/features/finance.css');
@import url('~/assets/css/responsive/finance.css');
</style>
