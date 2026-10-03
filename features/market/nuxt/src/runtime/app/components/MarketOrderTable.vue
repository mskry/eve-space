<script setup lang="ts">
import { useMarketOrderPaging, type MarketPageDirection } from '../useMarketOrderPaging'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  formatMarketIsk,
  formatMarketPriceDelta,
  isMarketLowballBuy,
  marketBuyOrderTags,
  sortMarketOrders,
  type MarketOrderSort,
} from '../market-order-presentation'
import { formatMarketIskAmount } from '../market-isk'
import {
  formatMarketRemainingCompact,
  formatMarketTimeUtc,
  marketRemainingMinutes,
} from '../market-time'
import type { MarketObservedBook, MarketOrderRow } from '../market-models'

interface MarketColumn {
  key: MarketOrderSort
  label: string
  numeric: boolean
}
const pageSize = 100
const rowHeight = 34
const expiringSoonMinutes = 1_440

const props = defineProps<{ book: MarketObservedBook; side: 'sell' | 'buy' }>()
const paging = useMarketOrderPaging(
  computed(() => props.book),
  computed(() => props.side),
)
const { loading, canPrevious: canPreviousPage } = paging
const rows = computed(() => paging.page.value.rows)
const hasMore = computed(() => paging.page.value.hasMore)
const pageIndex = computed(() => paging.page.value.index)
const observationUnavailable = computed(() => paging.failure.value === 'observation')
const error = computed(() => paging.failure.value === 'page' || observationUnavailable.value)
const emit = defineEmits<{ restart: [] }>()
const clipboard = useUiClipboard()
const scrollArea = ref<HTMLDivElement | null>(null)
const heading = computed(() => (props.side === 'sell' ? 'Sellers' : 'Buyers'))
const title = computed(() => (props.side === 'sell' ? 'Sell orders' : 'Buy orders'))
const sourcePage = computed(() => (props.side === 'sell' ? props.book.sellers : props.book.buyers))
const bottomSpacerHeight = ref(0)
const field = ref<MarketOrderSort>('price')
const direction = ref<'asc' | 'desc'>(props.side === 'sell' ? 'asc' : 'desc')
const now = ref<number | null>(null)
const copiedOrderId = ref<number | null>(null)
let clock: ReturnType<typeof setInterval> | undefined
let copiedTimer: ReturnType<typeof setTimeout> | undefined
watch(
  paging.identity,
  () => {
    bottomSpacerHeight.value = 0
    copiedOrderId.value = null
    field.value = 'price'
    direction.value = props.side === 'sell' ? 'asc' : 'desc'
    void nextTick(() => {
      if (scrollArea.value) scrollArea.value.scrollTop = 0
    })
  },
  { flush: 'sync' },
)
onMounted(() => {
  now.value = Date.now()
  clock = setInterval(() => {
    now.value = Date.now()
  }, 60_000)
})
onUnmounted(() => {
  if (clock) clearInterval(clock)
  clearTimeout(copiedTimer)
})

const visibleRows = computed(() =>
  sortMarketOrders(rows.value, props.side, field.value, direction.value),
)
const columns: readonly MarketColumn[] = [
  { key: 'price', label: 'Price', numeric: true },
  { key: 'volume', label: 'Qty', numeric: true },
  { key: 'location', label: 'Location', numeric: false },
  { key: 'expiry', label: 'Expires', numeric: true },
]
const spacerHeight = computed(() => pageIndex.value * pageSize * rowHeight)
const bestPrice = computed(() => sortMarketOrders(sourcePage.value.rows, props.side)[0]?.price)
const defaultOrder = computed(
  () => field.value === 'price' && direction.value === (props.side === 'sell' ? 'asc' : 'desc'),
)
const sortHint = computed(() => {
  if (!rows.value.length) return ''
  if (field.value !== 'price') return 'Sorted view'
  return direction.value === 'asc' ? 'ISK · lowest first' : 'ISK · highest first'
})
const depthByOrder = computed(() => {
  const depth = new Map<number, string>()
  if (!defaultOrder.value || pageIndex.value > 0) return depth
  const total = visibleRows.value.reduce((sum, row) => sum + row.volumeRemain, 0)
  if (!total) return depth
  let cumulative = 0
  for (const row of visibleRows.value) {
    cumulative += row.volumeRemain
    depth.set(row.orderId, `${Math.max(2, (cumulative / total) * 100).toFixed(1)}%`)
  }
  return depth
})
const priceDelta = (row: MarketOrderRow) => {
  const best = bestPrice.value
  if (!best) return ''
  return row.price === best ? 'Best' : formatMarketPriceDelta(row.price, best)
}
const expiringSoon = (row: MarketOrderRow) =>
  now.value !== null && marketRemainingMinutes(row.expiryAt, now.value) < expiringSoonMinutes
const lowball = (row: MarketOrderRow) => {
  const best = bestPrice.value
  return props.side === 'buy' && best !== undefined && isMarketLowballBuy(row.price, best)
}
const rowTags = (row: MarketOrderRow) => (props.side === 'buy' ? marketBuyOrderTags(row) : [])
const copyPrice = async (row: MarketOrderRow) => {
  try {
    await clipboard.writeText(row.price)
  } catch {
    return
  }
  copiedOrderId.value = row.orderId
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    copiedOrderId.value = null
  }, 1_200)
}

const changeSort = (key: MarketOrderSort) => {
  if (field.value === key) {
    direction.value = direction.value === 'asc' ? 'desc' : 'asc'
    return
  }
  field.value = key
  direction.value = key === 'price' && props.side === 'buy' ? 'desc' : 'asc'
}
const sortDirectionFor = (key: MarketOrderSort) => {
  if (field.value !== key) return undefined
  return direction.value === 'asc' ? 'ascending' : 'descending'
}
const positionPage = async (pageDirection: MarketPageDirection) => {
  await nextTick()
  const area = scrollArea.value
  if (!area) return
  // A short final page needs enough scroll space to avoid immediately reloading its predecessor.
  bottomSpacerHeight.value =
    pageIndex.value > 0
      ? Math.max(0, area.clientHeight - rows.value.length * rowHeight + rowHeight * 2)
      : 0
  await nextTick()
  area.scrollTop =
    pageDirection === 'next'
      ? spacerHeight.value + 1
      : Math.max(0, spacerHeight.value + rows.value.length * rowHeight - area.clientHeight - 1)
}
type PageAction = () => MarketPageDirection | null | Promise<MarketPageDirection | null>
const movePage = async (action: PageAction) => {
  const movement = await action()
  if (movement) await positionPage(movement)
}
const nextPage = () => movePage(paging.next)
const previousPage = () => movePage(paging.previous)
const restoreFirstPage = () => movePage(paging.first)
const retryPage = () => movePage(paging.retry)

const onScroll = () => {
  const area = scrollArea.value
  if (!area || loading.value) return
  if (pageIndex.value > 0 && area.scrollTop < spacerHeight.value - 8) {
    previousPage()
    return
  }
  if (hasMore.value && area.scrollTop + area.clientHeight >= area.scrollHeight - 8) nextPage()
}
</script>

<template>
  <section
    class="market-order-table"
    :class="{ 'market-order-table--buy': side === 'buy' }"
    :aria-label="heading"
  >
    <header class="market-order-table__header">
      <h3>{{ title }}</h3>
      <span class="market-order-table__hint">{{ sortHint }}</span>
    </header>
    <output v-if="paging.failure.value === 'side'" class="market-order-table__empty">
      {{ heading }} are unavailable.
      <button type="button" @click="emit('restart')">Retry market orders</button>
    </output>
    <output v-else-if="!rows.length && !observationUnavailable" class="market-order-table__empty"
      >No {{ side === 'sell' ? 'sell' : 'buy' }} orders observed.</output
    >
    <div
      v-if="rows.length"
      ref="scrollArea"
      class="market-order-table__scroll"
      tabindex="0"
      :aria-label="`${heading} orders; scroll to inspect more orders`"
      @scroll.passive="onScroll"
    >
      <table>
        <caption class="sr-only">
          {{
            heading
          }}
          from one complete observation; scroll to inspect more orders. Sorting applies to visible
          rows only. Prices are individual orders, not quantity-aware quotes. Select a price to copy
          it.
        </caption>
        <thead>
          <tr>
            <th
              v-for="column in columns"
              :key="column.key"
              scope="col"
              :class="{ 'market-order-table__numeric': column.numeric }"
              :aria-sort="sortDirectionFor(column.key)"
            >
              <button
                type="button"
                :aria-label="`Sort visible ${heading} orders by ${column.label}`"
                @click="changeSort(column.key)"
              >
                <span>{{ column.label }}</span>
                <svg
                  v-if="field === column.key"
                  viewBox="0 0 15 15"
                  width="15"
                  height="15"
                  fill="none"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    :d="direction === 'asc' ? 'M4 9H11L7.5 4.5L4 9Z' : 'M4 6H11L7.5 10.5L4 6Z'"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="spacerHeight" class="market-order-table__spacer" aria-hidden="true">
            <td :colspan="columns.length" :style="{ height: `${spacerHeight}px` }" />
          </tr>
          <tr
            v-for="row in visibleRows"
            :key="row.orderId"
            class="market-order-table__row"
            :class="{
              'market-order-table__row--best': row.price === bestPrice,
              'market-order-table__row--lowball': lowball(row),
            }"
            :title="lowball(row) ? 'Lowball order: half the best buy or less' : undefined"
            :style="{ '--market-order-depth': depthByOrder.get(row.orderId) ?? '0%' }"
            @click="copyPrice(row)"
          >
            <td class="market-order-table__numeric market-order-table__price">
              <button
                type="button"
                :aria-label="`Copy price ${formatMarketIsk(row.price)}`"
                @click.stop="copyPrice(row)"
              >
                <span class="market-order-table__price-value">{{
                  formatMarketIskAmount(row.price)
                }}</span>
                <span v-if="priceDelta(row)" class="market-order-table__delta">{{
                  priceDelta(row)
                }}</span>
              </button>
            </td>
            <td class="market-order-table__numeric">
              {{ row.volumeRemain.toLocaleString('en-US') }}
            </td>
            <td class="market-order-table__location">
              <span class="market-order-table__location-inner">
                <UiSystemSecurityStatus
                  v-if="row.solarSystemSecurityStatus !== null"
                  class="market-order-table__security"
                  :value="row.solarSystemSecurityStatus"
                />
                <span v-else class="market-order-table__security">—</span>
                <span
                  class="market-order-table__location-name"
                  :class="{ 'market-order-table__location-name--unresolved': !row.locationName }"
                  :title="row.locationName ?? `Location ${row.locationId}`"
                  >{{ row.locationName ?? `Location ${row.locationId}` }}</span
                >
                <span v-if="lowball(row)" class="sr-only">Lowball order.</span>
                <span v-for="tag in rowTags(row)" :key="tag" class="market-order-table__tag">{{
                  tag
                }}</span>
              </span>
            </td>
            <td
              class="market-order-table__numeric market-order-table__expiry"
              :class="{ 'market-order-table__expiry--soon': expiringSoon(row) }"
            >
              <time
                :datetime="row.expiryAt"
                :title="formatMarketTimeUtc(row.expiryAt)"
                :aria-label="`Expires ${formatMarketTimeUtc(row.expiryAt)}`"
                >{{
                  now === null
                    ? formatMarketTimeUtc(row.expiryAt).slice(0, 10)
                    : formatMarketRemainingCompact(row.expiryAt, now)
                }}</time
              >
              <span v-if="copiedOrderId === row.orderId" class="market-order-table__copied"
                >Copied</span
              >
            </td>
          </tr>
          <tr v-if="bottomSpacerHeight" class="market-order-table__spacer" aria-hidden="true">
            <td :colspan="columns.length" :style="{ height: `${bottomSpacerHeight}px` }" />
          </tr>
        </tbody>
      </table>
      <p v-if="loading" class="market-order-table__status market-order-table__status--loading">
        <span class="market-order-table__spinner" aria-hidden="true"></span>
        Loading more orders
      </p>
      <p v-else-if="!hasMore" class="market-order-table__status">End of order book</p>
    </div>
    <nav
      v-if="rows.length && (hasMore || pageIndex > 0)"
      class="market-order-table__pages"
      :aria-label="`${heading} order pages`"
    >
      <button type="button" :disabled="loading || pageIndex === 0" @click="restoreFirstPage">
        First orders
      </button>
      <button type="button" :disabled="loading || !canPreviousPage" @click="previousPage">
        Previous orders
      </button>
      <button type="button" :disabled="loading || !hasMore" @click="nextPage">Next orders</button>
    </nav>
    <output v-if="rows.length" class="sr-only" aria-live="polite"
      >Showing {{ pageIndex * pageSize + 1 }}–{{ pageIndex * pageSize + rows.length }}
      {{ heading.toLowerCase() }} orders.</output
    >
    <output v-if="copiedOrderId !== null" class="sr-only" aria-live="polite">Price copied.</output>
    <output v-if="loading" class="sr-only">Loading more {{ heading.toLowerCase() }} orders</output>
    <output v-if="sourcePage.error && sourcePage.kind !== 'unavailable'"
      >Order refresh failed; showing the previously loaded side.</output
    >
    <div v-if="error" class="market-order-table__error">
      <output v-if="observationUnavailable"
        >This market observation is unavailable. Restart to discover the latest book.</output
      >
      <output v-else>More orders are unavailable; the current rows remain visible.</output>
      <button v-if="observationUnavailable" type="button" @click="emit('restart')">
        Restart with the latest market observation
      </button>
      <button v-else type="button" @click="retryPage">Retry loading orders</button>
    </div>
  </section>
</template>

<style scoped>
.market-order-table {
  min-width: 0;
  min-height: 0;
  max-height: clamp(19rem, 58dvh, 42rem);
  display: flex;
  flex-direction: column;
}
.market-order-table__pages {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
}
.market-order-table__header {
  display: flex;
  align-items: baseline;
  gap: 0.625rem;
  padding: 0.75rem 1rem 0.625rem;
}
.market-order-table h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 500;
}
.market-order-table__hint,
.market-order-table th,
.market-order-table__delta,
.market-order-table__tag,
.market-order-table__copied,
.market-order-table__status {
  font-family: var(--ui-font-mono);
  font-weight: 700;
  line-height: 1;
  text-transform: uppercase;
}
.market-order-table__hint {
  margin-left: auto;
  color: var(--ui-text-muted);
  font-size: 0.5625rem;
  letter-spacing: 0.1em;
}
.market-order-table__empty {
  display: block;
  padding: 1.375rem 1rem;
  border-top: 1px solid var(--ui-border);
  color: var(--ui-text-muted);
  font-size: 0.8125rem;
  text-align: center;
}
.market-order-table__scroll {
  position: relative;
  min-height: 0;
  max-width: 100%;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-color: color-mix(in srgb, var(--ui-primary) 30%, transparent) transparent;
  scrollbar-width: thin;
}
table {
  width: 100%;
  min-width: 30rem;
  table-layout: fixed;
  border-collapse: collapse;
  font: 0.875rem/1 var(--ui-font-body);
  font-variant-numeric: tabular-nums;
}
th,
td {
  box-sizing: border-box;
  padding: 0 0.625rem 0 0;
  white-space: nowrap;
}
th:first-child,
td:first-child {
  width: 7.5rem;
  padding-left: 1rem;
}
th:nth-child(2),
td:nth-child(2) {
  width: 4.5rem;
}
th:last-child,
td:last-child {
  width: 5.25rem;
  padding-right: 1rem;
}
th {
  position: sticky;
  top: 0;
  z-index: 1;
  height: 1.625rem;
  border-bottom: 1px solid var(--ui-border);
  background: var(--ui-surface-solid);
  color: var(--ui-text-muted);
  font-size: 0.5625rem;
  letter-spacing: 0.12em;
  text-align: left;
}
th button {
  width: 100%;
  min-height: 1rem;
  display: flex;
  align-items: center;
  gap: 0.125rem;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  cursor: pointer;
}
th button:hover {
  color: var(--ui-primary);
}
.market-order-table__numeric button {
  justify-content: flex-end;
}
th button svg {
  width: 0.75rem;
  height: 0.75rem;
  flex: 0 0 0.75rem;
  color: var(--ui-primary);
}
th.market-order-table__numeric,
td.market-order-table__numeric {
  text-align: right;
}
.market-order-table__row {
  height: 34px;
  border-bottom: 1px solid color-mix(in srgb, var(--ui-border) 36%, transparent);
  background-image: linear-gradient(
    90deg,
    var(--market-order-depth-color) var(--market-order-depth),
    transparent var(--market-order-depth)
  );
  background-repeat: no-repeat;
  background-size: 100% calc(100% - 6px);
  background-position: 0 3px;
  animation: market-order-depth-reveal 550ms ease-out both;
  cursor: copy;
  --market-order-depth-color: color-mix(in srgb, var(--ui-primary) 11%, transparent);
}
@keyframes market-order-depth-reveal {
  from {
    background-size: 0% calc(100% - 6px);
  }
  to {
    background-size: 100% calc(100% - 6px);
  }
}
.market-order-table--buy .market-order-table__row {
  --market-order-depth-color: color-mix(in srgb, var(--ui-text-muted) 10%, transparent);
}
.market-order-table__row:hover {
  background-color: color-mix(in srgb, var(--ui-primary) 7%, transparent);
}
.market-order-table__price button {
  width: 100%;
  display: grid;
  justify-items: end;
  gap: 0.125rem;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  cursor: copy;
}
.market-order-table__price-value {
  font-size: 0.875rem;
}
.market-order-table__row--lowball {
  opacity: 0.45;
}
.market-order-table__row--lowball:hover,
.market-order-table__row--lowball:focus-within {
  opacity: 1;
}
.market-order-table__row--best .market-order-table__price-value {
  color: var(--ui-primary-hover);
}
.market-order-table--buy .market-order-table__row--best .market-order-table__price-value {
  color: var(--ui-text);
  font-weight: 500;
}
.market-order-table__delta {
  color: var(--ui-text-faint);
  font-size: 0.5rem;
  letter-spacing: 0.06em;
}
.market-order-table__location-inner {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.market-order-table__security {
  width: 1.375rem;
  flex: 0 0 1.375rem;
  font-size: 0.75rem;
  font-weight: 700;
  text-align: left;
}
.market-order-table__location-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.market-order-table__location-name--unresolved {
  color: var(--ui-text-muted);
}
.market-order-table__tag {
  flex: 0 0 auto;
  padding: 0.1875rem 0.3125rem;
  border: 1px solid var(--ui-border-strong);
  color: var(--ui-text-muted);
  font-size: 0.5rem;
  letter-spacing: 0.08em;
}
.market-order-table__expiry {
  position: relative;
  color: var(--ui-text-muted);
  font-size: 0.8125rem;
}
.market-order-table__expiry--soon {
  color: var(--ui-warning);
}
.market-order-table__copied {
  position: absolute;
  top: 50%;
  right: 1rem;
  padding: 0.25rem 0.4375rem;
  background: var(--ui-primary);
  color: var(--ui-on-primary);
  font-size: 0.5625rem;
  letter-spacing: 0.12em;
  transform: translateY(-50%);
}
.market-order-table__spacer td {
  padding: 0;
  border: 0;
}
.market-order-table__status {
  height: 1.875rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5625rem;
  margin: 0;
  color: var(--ui-text-faint);
  font-size: 0.5rem;
  letter-spacing: 0.13em;
}
.market-order-table__status--loading {
  height: 34px;
  color: var(--ui-primary);
  font-size: 0.5625rem;
}
.market-order-table__spinner {
  width: 0.5625rem;
  height: 0.5625rem;
  display: block;
  border: 1.5px solid color-mix(in srgb, var(--ui-primary) 30%, transparent);
  border-top-color: var(--ui-primary);
  border-radius: 50%;
  animation: market-order-table-spin 0.7s linear infinite;
}
@keyframes market-order-table-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .market-order-table__row {
    animation: none;
  }
  .market-order-table__spinner {
    animation-duration: 2.4s;
  }
}
.market-order-table__error {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-top: 1px solid var(--ui-border);
  color: var(--ui-warning);
  font-size: 0.8125rem;
}
.market-order-table__error button {
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--ui-border-strong);
  background: var(--ui-control);
  color: var(--ui-text);
  font: 0.75rem/1 var(--ui-font-body);
  cursor: pointer;
}
.market-order-table :focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: -2px;
}
</style>
