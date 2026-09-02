<script setup lang="ts">
import type {
  FinanceResourceState,
  FinanceTransaction,
  FinanceTransactions,
  FinanceTransactionSideFilter,
} from '../../types/finance'
import {
  formatFinanceCollectionCount,
  formatFinanceDate,
  formatFinanceIsk,
} from '../../utils/finance'

const props = defineProps<{
  emptyMessage: string
  filter: FinanceTransactionSideFilter
  now: number
  rangeIndex: number
  searchQuery: string
  state: FinanceResourceState
  transactionRows: readonly FinanceTransaction[]
  transactions: FinanceTransactions | null
}>()

const emit = defineEmits<{
  'change-filter': [filter: FinanceTransactionSideFilter]
  'change-search': [query: string]
  'load-older': []
  refresh: []
  'show-newer': []
}>()

const filterOptions: ReadonlyArray<{ label: string; value: FinanceTransactionSideFilter }> = [
  { value: 'All', label: 'All' },
  { value: 'Buy', label: 'Buy' },
  { value: 'Sell', label: 'Sell' },
]
const selectedFilter = computed<string>({
  get: () => props.filter,
  set: (value) => emit('change-filter', value as FinanceTransactionSideFilter),
})
const countLabel = computed(() =>
  formatFinanceCollectionCount(
    props.transactionRows.length,
    props.transactions?.transactions.length ?? 0,
    'loaded-range',
  ),
)
const continuation = computed(() => ({
  rangeIndex: props.rangeIndex,
  hasNewer: props.rangeIndex > 0,
  hasOlder: props.transactions?.nextFromId !== null && props.transactions?.nextFromId !== undefined,
}))

function changeSearch(event: Event) {
  emit('change-search', (event.target as HTMLInputElement).value)
}
</script>

<template>
  <div class="finance-service-body">
    <FinanceServicePanel
      :has-data="Boolean(transactions)"
      :state="state"
      title="Market transactions"
      :validated-at="transactions?.validatedAt"
      @retry="emit('refresh')"
    >
      <div class="finance-toolbar">
        <UiToggleGroup v-model="selectedFilter" label="Transaction side" :options="filterOptions" />
        <label class="finance-search">
          <span class="sr-only">Filter the loaded transaction range</span>
          <input
            class="ui-input"
            :value="searchQuery"
            type="search"
            placeholder="Filter by item or station"
            @input="changeSearch"
          />
        </label>
      </div>
      <UiStatePanel
        v-if="transactionRows.length === 0"
        code="NO ACTIVITY"
        title="Transaction range empty"
        compact
        role="status"
      >
        <p>{{ emptyMessage }}</p>
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
            <tr v-for="transaction in transactionRows" :key="transaction.transactionId">
              <td class="is-mono">{{ formatFinanceDate(transaction.date) }}</td>
              <td>
                <span class="finance-side" :class="transaction.isBuy ? 'is-buy' : 'is-sell'">
                  {{ transaction.isBuy ? 'BUY' : 'SELL' }}
                </span>
              </td>
              <td class="is-truncated">
                <FinanceItemIdentity :name="transaction.typeName" :type-id="transaction.typeId" />
              </td>
              <td class="is-numeric is-mono is-subtle">
                {{ transaction.quantity.toLocaleString('en-US') }}
              </td>
              <td class="is-numeric is-mono is-subtle">
                {{ formatFinanceIsk(transaction.unitPrice) }}
              </td>
              <td
                class="is-numeric is-mono"
                :class="transaction.isBuy ? 'is-expense' : 'is-income'"
              >
                {{ transaction.isBuy ? '-' : '+' }}{{ formatFinanceIsk(transaction.totalPrice) }}
              </td>
              <td class="is-truncated is-subtle">
                {{ transaction.locationName ?? `Location ${transaction.locationId}` }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <FinanceServiceFooter
        :continuation="continuation"
        :count-label="countLabel"
        :loading="state.loading"
        :now="now"
        :validated-at="transactions?.validatedAt"
        @load-older="emit('load-older')"
        @refresh="emit('refresh')"
        @show-newer="emit('show-newer')"
      />
    </FinanceServicePanel>
  </div>
</template>
