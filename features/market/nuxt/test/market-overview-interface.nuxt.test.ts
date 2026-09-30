import { mountSuspended } from '@nuxt/test-utils/runtime'
import { TooltipProvider } from 'reka-ui'
import { expect, test } from 'vitest'
import { defineComponent, h } from 'vue'
import MarketOrderTables from '../src/runtime/app/components/MarketOrderTables.vue'
import MarketBookSummary from '../src/runtime/app/components/MarketBookSummary.vue'
import MarketPriceHistory from '../src/runtime/app/components/MarketPriceHistory.vue'
import MarketHistoryChart from '../src/runtime/app/components/MarketHistoryChart.vue'
import { marketHistorySeries } from '../src/runtime/app/market-history-presentation'
import type { MarketObservedBook, MarketDailyHistory } from '../src/runtime/app/useMarketOverview'

const observedAt = '2026-09-01T00:00:00.000Z'
const row = (orderId: number, side: 'buy' | 'sell', price: string) => ({
  orderId,
  side,
  price,
  volumeRemain: 10,
  locationId: 60003760,
  solarSystemId: 30000142,
  locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
  solarSystemSecurityStatus: 0.945913,
  issuedAt: observedAt,
  durationDays: 90,
  expiryAt: '2026-11-30T00:00:00.000Z',
  minimumVolume: 5,
  range: 'region',
})
const book = {
  status: 'current',
  collectionStatus: 'ready',
  replacement: null,
  observation: {
    observationId: '00000000-0000-4000-8000-000000000002',
    profileId: '00000000-0000-4000-8000-000000000001',
    regionId: 10000002,
    typeId: 34,
    observedAt,
    validatedAt: observedAt,
    freshUntil: '2026-10-01T00:00:00.000Z',
    expectedPages: 1,
    totalBookOrders: 3,
  },
  sellers: { rows: [row(1, 'sell', '5.00'), row(2, 'sell', '2.00')], hasMore: false },
  buyers: { rows: [row(3, 'buy', '1.00')], hasMore: false },
} satisfies MarketObservedBook

test('separates sortable, labelled order tables and keeps each side within its own scroll area', async () => {
  const wrapper = await mountSuspended(MarketOrderTables, { props: { book } })
  const sellers = wrapper.get('section[aria-label="Sellers"]')
  const buyers = wrapper.get('section[aria-label="Buyers"]')
  expect(sellers.findAll('tbody tr')).toHaveLength(2)
  expect(buyers.findAll('tbody tr')).toHaveLength(1)
  expect(sellers.get('.market-order-table__hint').text()).toBe('ISK · lowest first')
  expect(buyers.get('.market-order-table__hint').text()).toBe('ISK · highest first')
  expect(sellers.get('th[aria-sort="ascending"]').text()).toContain('Price')
  expect(sellers.get('th[aria-sort="ascending"] svg path').attributes('d')).toBe(
    'M4 9H11L7.5 4.5L4 9Z',
  )
  expect(buyers.get('th[aria-sort="descending"]').text()).toContain('Price')
  expect(buyers.text()).toContain('Min 5')
  expect(buyers.get('time').attributes('datetime')).toBe('2026-11-30T00:00:00.000Z')
  expect(buyers.get('time').attributes('title')).toBe('2026-11-30 00:00 UTC')
  expect(buyers.text()).toContain('Jita IV - Moon 4 - Caldari Navy Assembly Plant')
  expect(buyers.text()).toContain('0.9')
  expect(buyers.text()).not.toContain('Region')
  expect(sellers.findAll('tbody tr')[0]?.text()).toContain('Best')
  expect(
    sellers
      .get('[aria-label="Sellers orders; scroll to inspect more orders"]')
      .attributes('tabindex'),
  ).toBe('0')
  await sellers.get('button[aria-label="Sort visible Sellers orders by Price"]').trigger('click')
  expect(sellers.get('.market-order-table__hint').text()).toBe('ISK · highest first')
  expect(sellers.find('.market-order-table__hint-arrow').exists()).toBe(false)
  expect(sellers.get('th[aria-sort="descending"]').text()).toContain('Price')
  expect(sellers.get('th[aria-sort="descending"] svg path').attributes('d')).toBe(
    'M4 6H11L7.5 10.5L4 6Z',
  )
  expect(sellers.findAll('tbody tr')[0]?.text()).toContain('5.00')
  expect(sellers.findAll('button').map((button) => button.text())).not.toContain('Previous')
  expect(sellers.findAll('button').map((button) => button.text())).not.toContain('Next')
  await wrapper.setProps({
    book: {
      ...book,
      observation: { ...book.observation, typeId: 35 },
      sellers: { rows: [], hasMore: false },
      buyers: { rows: [], hasMore: false },
    },
  })
  expect(wrapper.get('section[aria-label="Sellers"]').findAll('tbody tr')).toHaveLength(0)
  expect(wrapper.get('section[aria-label="Buyers"]').findAll('tbody tr')).toHaveLength(0)
  expect(wrapper.text()).toContain('No sell orders observed.')
  expect(wrapper.text()).not.toContain('Showing 1–0')
  wrapper.unmount()
})

test('identifies the best buy and sell with directional marks beside their prices', async () => {
  const wrapper = await mountSuspended(MarketBookSummary, { props: { book } })
  const labels = wrapper.findAll('.market-book-summary__pair:first-child dt')
  expect(labels.map((label) => label.text())).toEqual(['Best sell', 'Best buy'])
  const prices = wrapper.findAll('.market-book-summary__pair:first-child dd')
  expect(prices[0]?.get('.market-book-summary__arrow--sell').attributes('aria-hidden')).toBe('true')
  expect(prices[1]?.get('.market-book-summary__arrow--buy').attributes('aria-hidden')).toBe('true')
  expect(prices[0]?.text()).toContain('2.00')
  expect(prices[0]?.attributes('title')).toBe('2.00 ISK')
  await wrapper.setProps({
    book: {
      ...book,
      sellers: { rows: [row(10, 'sell', '1887000000.00')], hasMore: false },
      buyers: { rows: [row(11, 'buy', '1700000000.00')], hasMore: false },
    },
  })
  const largePrices = wrapper.findAll('.market-book-summary__pair:first-child dd')
  expect(largePrices[0]?.text()).toContain('1.89B')
  expect(largePrices[0]?.attributes('title')).toBe('1,887,000,000.00 ISK')
  expect(largePrices[1]?.text()).toContain('1.70B')
  expect(
    wrapper.get('.market-book-summary__pair:last-child .market-book-summary__value').text(),
  ).toBe('187.00M')
  wrapper.unmount()
})

const oneDay = {
  status: 'observed',
  freshness: 'current',
  regionId: 10000002,
  typeId: 34,
  validatedAt: observedAt,
  freshUntil: '2026-10-01T00:00:00.000Z',
  days: [
    {
      date: '2026-09-01',
      averageIsk: '4.00',
      highIsk: '5.00',
      lowIsk: '3.00',
      volume: 100,
      orderCount: 12,
    },
  ],
} satisfies MarketDailyHistory

test('dims lowball buy orders without dimming sells or the best buy', async () => {
  const wrapper = await mountSuspended(MarketOrderTables, {
    props: {
      book: {
        ...book,
        sellers: { rows: [row(1, 'sell', '0.01'), row(2, 'sell', '4934000.00')], hasMore: false },
        buyers: {
          rows: [row(3, 'buy', '4667000.00'), row(4, 'buy', '0.01')],
          hasMore: false,
        },
      },
    },
  })
  const buyers = wrapper.get('section[aria-label="Buyers"]')
  const lowball = buyers.findAll('.market-order-table__row--lowball')
  expect(lowball).toHaveLength(1)
  expect(lowball[0]?.text()).toContain('0.01')
  expect(lowball[0]?.text()).toContain('Lowball order.')
  expect(
    wrapper.get('section[aria-label="Sellers"]').find('.market-order-table__row--lowball').exists(),
  ).toBe(false)
  wrapper.unmount()
})

test('one-day history retains its exact value without inventing a chart', async () => {
  const wrapper = await mountSuspended(MarketPriceHistory, { props: { history: oneDay } })
  expect(wrapper.text()).toContain('Only one day is available')
  expect(wrapper.text()).toContain('Daily Average 4.00 ISK')
  expect(wrapper.find('table').exists()).toBe(false)
  expect(wrapper.find('canvas').exists()).toBe(false)
  wrapper.unmount()
})

test('uncollected history has no invented chart or data rows', async () => {
  const wrapper = await mountSuspended(MarketPriceHistory, {
    props: {
      history: {
        ...oneDay,
        status: 'uncollected',
        freshness: 'uncollected',
        validatedAt: null,
        freshUntil: null,
        days: [],
      },
    },
  })
  expect(wrapper.text()).toContain('has not been collected')
  expect(wrapper.find('canvas').exists()).toBe(false)
  expect(wrapper.find('table').exists()).toBe(false)
  wrapper.unmount()
})

test('chart keeps keyboard inspection and an overview range without visible date controls', async () => {
  const days = marketHistorySeries([
    oneDay.days[0]!,
    {
      date: '2026-09-02',
      averageIsk: '4.50',
      highIsk: '6.00',
      lowIsk: '4.00',
      volume: 200,
      orderCount: 15,
    },
  ])
  const Host = defineComponent({
    setup: () => () => h(TooltipProvider, null, { default: () => h(MarketHistoryChart, { days }) }),
  })
  const wrapper = await mountSuspended(Host, { route: false })
  expect(wrapper.findAll('canvas')).toHaveLength(2)
  const chart = wrapper.get('canvas[tabindex="0"]')
  expect(chart.attributes('aria-label')).toContain('2026-09-02')
  expect(wrapper.find('input[type="date"]').exists()).toBe(false)
  expect(wrapper.find('input[type="range"]').exists()).toBe(false)
  await chart.trigger('keydown', { key: 'ArrowLeft' })
  expect(chart.attributes('aria-label')).toContain('2026-09-01')
  expect(chart.attributes('aria-label')).toContain('4.00 ISK')
  expect(wrapper.find('output').exists()).toBe(false)
  wrapper.unmount()
})
