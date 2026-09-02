<script setup lang="ts">
import type {
  FinanceOrder,
  FinanceOrderFilter,
  FinanceOrderHistory,
  FinanceOrderMode,
  FinanceOrders,
  FinancePageMetadata,
  FinanceResourceState,
} from '../../types/finance'
import {
  expiresWithinFinanceUrgency,
  financeOrderFill,
  financeOrderSide,
  financeOrderStateLabel,
  financeOrderVolumeNumerator,
  formatFinanceCollectionCount,
  formatFinanceCountdown,
  formatFinanceIsk,
  formatFinanceTerm,
} from '../../utils/finance'

const props = defineProps<{
  activeOrders: readonly FinanceOrder[]
  emptyMessage: string
  filter: FinanceOrderFilter
  mode: FinanceOrderMode
  now: number
  orderRows: readonly FinanceOrder[]
  orders: FinanceOrders | FinanceOrderHistory | null
  scopeNote: string
  state: FinanceResourceState
}>()

const emit = defineEmits<{
  'change-filter': [filter: FinanceOrderFilter]
  'change-mode': [mode: FinanceOrderMode]
  'change-page': [page: number]
  refresh: []
}>()

const modeOptions: ReadonlyArray<{ label: string; value: FinanceOrderMode }> = [
  { value: 'open', label: 'Open orders' },
  { value: 'history', label: 'Order history' },
]
const filterOptions: ReadonlyArray<{ label: string; value: FinanceOrderFilter }> = [
  { value: 'All', label: 'All' },
  { value: 'Buy', label: 'Buy' },
  { value: 'Sell', label: 'Sell' },
  { value: 'Escrowed', label: 'Escrowed' },
]
const selectedMode = computed<string>({
  get: () => props.mode,
  set: (value) => emit('change-mode', value as FinanceOrderMode),
})
const selectedFilter = computed<string>({
  get: () => props.filter,
  set: (value) => emit('change-filter', value as FinanceOrderFilter),
})
const page = computed<FinancePageMetadata | null>(() => {
  if (props.mode !== 'history' || !props.orders || !('page' in props.orders)) return null
  return { page: props.orders.page, totalPages: props.orders.totalPages }
})
const countLabel = computed(() =>
  formatFinanceCollectionCount(
    props.orderRows.length,
    props.activeOrders.length,
    props.mode === 'open' ? 'complete-collection' : 'loaded-page',
  ),
)
</script>

<template>
  <div class="finance-service-body">
    <FinanceServicePanel
      :has-data="Boolean(orders)"
      :state="state"
      title="Market orders"
      :validated-at="orders?.validatedAt"
      @retry="emit('refresh')"
    >
      <div class="finance-toolbar">
        <UiToggleGroup v-model="selectedMode" label="Order collection" :options="modeOptions" />
        <UiToggleGroup v-model="selectedFilter" label="Order filter" :options="filterOptions" />
        <span class="finance-toolbar-note">{{ scopeNote }}</span>
      </div>
      <UiStatePanel
        v-if="orderRows.length === 0"
        code="NO ORDERS"
        :title="mode === 'open' ? 'No open orders' : 'History page empty'"
        compact
        role="status"
      >
        <p>{{ emptyMessage }}</p>
      </UiStatePanel>
      <div v-else class="finance-table-scroll">
        <table class="finance-table finance-table--orders">
          <thead>
            <tr>
              <th scope="col">Side</th>
              <th scope="col">Item</th>
              <th scope="col" class="is-numeric">Price</th>
              <th scope="col">{{ mode === 'open' ? 'Remaining' : 'Traded' }}</th>
              <th scope="col">Range</th>
              <th scope="col">Location</th>
              <th scope="col" class="is-numeric">Escrow</th>
              <th scope="col" class="is-numeric">{{ mode === 'open' ? 'Expires' : 'State' }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="order in orderRows" :key="order.orderId">
              <td>
                <span class="finance-side" :class="`is-${financeOrderSide(order.isBuy)}`">
                  {{ financeOrderSide(order.isBuy).toLocaleUpperCase('en-US') }}
                </span>
              </td>
              <td class="is-truncated">
                <FinanceItemIdentity :name="order.typeName" :type-id="order.typeId" />
              </td>
              <td class="is-numeric is-mono">{{ formatFinanceIsk(order.price) }}</td>
              <td>
                <span class="finance-volume">
                  {{ financeOrderVolumeNumerator(order, mode).toLocaleString('en-US') }} /
                  {{ order.volumeTotal.toLocaleString('en-US') }}
                </span>
                <span class="finance-fill" aria-hidden="true">
                  <span
                    class="finance-fill-bar"
                    :class="`is-${financeOrderSide(order.isBuy)}`"
                    :style="{ width: `${financeOrderFill(order)}%` }"
                  ></span>
                </span>
              </td>
              <td class="is-subtle is-capitalized">{{ order.range }}</td>
              <td class="is-truncated is-subtle">
                {{ order.locationName ?? `Location ${order.locationId}` }}
              </td>
              <td class="is-numeric is-mono is-subtle">{{ formatFinanceTerm(order.escrow) }}</td>
              <td class="is-numeric is-mono">
                <time
                  v-if="mode === 'open'"
                  :datetime="order.expiresAt"
                  :class="
                    expiresWithinFinanceUrgency(order.expiresAt, now) ? 'is-urgent' : 'is-subtle'
                  "
                >
                  {{ formatFinanceCountdown(order.expiresAt, now) }}
                </time>
                <span v-else class="is-subtle">{{ financeOrderStateLabel(order) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <FinanceServiceFooter
        :count-label="countLabel"
        :loading="state.loading"
        :now="now"
        :page="page"
        page-label="Order history pages"
        :validated-at="orders?.validatedAt"
        @change-page="emit('change-page', $event)"
        @refresh="emit('refresh')"
      />
    </FinanceServicePanel>
  </div>
</template>
