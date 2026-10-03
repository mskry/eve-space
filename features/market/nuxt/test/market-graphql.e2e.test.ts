// @vitest-environment node
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { $fetch, createPage, setup, url as serverUrl } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'
process.env.MARKET_PREVIEW_ORIGIN = 'http://127.0.0.1:3002'
const {
  marketGraphQLFixture,
  marketFixtureRequests,
  marketFixtureHttpRequests,
  resetMarketGraphQLFixture,
} = await import('../../../../tests/support/market-graphql-browser-fixture')

const server = serve({ fetch: marketGraphQLFixture.fetch, hostname: '127.0.0.1', port: 0 })
await once(server, 'listening')
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Expected a TCP fixture listener.')
const apiOrigin = `http://127.0.0.1:${address.port}`
process.env.NUXT_PUBLIC_API_BASE = apiOrigin
const regional = '00000000-0000-4000-8000-000000000001'
const plex = '00000000-0000-4000-8000-000000000004'
type GraphQLFixtureControls = {
  failSide?: boolean
  expiredObservation?: boolean
  demandReady?: boolean
  demandAccepted?: boolean
  rejectDocument?: string
  delayedType?: string
  delayMs?: number
}
type MarketFixtureControls = {
  history?: 'uncollected' | 'complete'
  book?: 'uncollected' | 'complete'
}
const state = (value: GraphQLFixtureControls) =>
  fetch(`${apiOrigin}/__fixture/graphql-state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  })
const domain = (value: MarketFixtureControls) =>
  fetch(`${apiOrigin}/__fixture/market-state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  })
const url = (typeId: number, profileId = regional, tab = 'data') =>
  `/market?typeId=${typeId}&profileId=${profileId}&tab=${tab}`
const operations = () =>
  marketFixtureRequests.map(({ query }) => {
    const operation = query.match(/query (\w+)/)?.[1]
    if (!operation) throw new Error('Expected a named generated operation.')
    return operation
  })
const openPage = async (path: string) => {
  const page = await createPage()
  const hydrationWarnings: string[] = []
  const browserReads: string[] = []
  page.on('console', (message) => {
    if (message.text().toLowerCase().includes('hydration')) hydrationWarnings.push(message.text())
  })
  page.on('pageerror', (error) => hydrationWarnings.push(error.message))
  page.on('request', (request) => {
    if (request.url().endsWith('/api/graphql')) browserReads.push(request.postData() ?? '')
  })
  resetMarketGraphQLFixture()
  await page.goto(serverUrl(path), { waitUntil: 'hydration' })
  return { page, hydrationWarnings, browserReads }
}
afterAll(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
)

describe('selected Market GraphQL production journey', async () => {
  await setup({
    browser: true,
    port: 3002,
    build: false,
    captureServerLogs: false,
    rootDir: fileURLToPath(new URL('../../../..', import.meta.url)),
    server: true,
    nuxtConfig: {
      nitro: {
        output: { dir: fileURLToPath(new URL('../../../../.output-e2e', import.meta.url)) },
      },
    },
  })

  it('renders anonymous regional and Global PLEX links and reuses every successful SSR read on hydration', async () => {
    for (const [typeId, profileId, name] of [
      [587, regional, 'Rifter'],
      [44992, plex, 'PLEX'],
    ] as const) {
      resetMarketGraphQLFixture()
      const html = await $fetch<string>(url(typeId, profileId), {
        headers: { cookie: 'unrelated-incoming-cookie=must-not-forward' },
      })
      expect(html).toContain(name)
      expect(html).toContain('Market summary')
      expect(operations().toSorted((left, right) => left.localeCompare(right))).toEqual([
        'MarketBook',
        'MarketInitialOrders',
        'MarketItem',
        'MarketProfiles',
      ])
      expect(operations().indexOf('MarketBook')).toBeLessThan(
        operations().indexOf('MarketInitialOrders'),
      )
      expect(marketFixtureHttpRequests.every((request) => request.cookie === null)).toBe(true)
      expect(
        marketFixtureHttpRequests.every(
          (request) =>
            request.path === '/api/modules' ||
            request.path === '/api/graphql' ||
            request.path.startsWith('/api/modules/market/catalogue/'),
        ),
      ).toBe(true)
      const { page, hydrationWarnings, browserReads } = await openPage(url(typeId, profileId))
      try {
        await page.getByRole('heading', { name, exact: true }).waitFor()
        await page.getByRole('region', { name: 'Sellers' }).locator('tbody tr').first().waitFor()
        await page.waitForLoadState('networkidle')
        expect(operations().toSorted((left, right) => left.localeCompare(right))).toEqual([
          'MarketBook',
          'MarketInitialOrders',
          'MarketItem',
          'MarketProfiles',
        ])
        expect(browserReads).toEqual([])
        expect(hydrationWarnings).toEqual([])
        const before = marketFixtureRequests.length
        await page.getByRole('tab', { name: 'Price History' }).click()
        await page.locator('canvas[aria-label^="Daily regional price history"]').waitFor()
        expect(operations().slice(before)).toEqual(['MarketHistory'])
        await page.getByRole('tab', { name: 'Order book' }).click()
        await page.waitForLoadState('networkidle')
        expect(operations().slice(before)).toEqual(['MarketHistory'])
      } finally {
        await page.close()
      }
    }
  })

  it('keeps anonymous history deep links independent and makes no SSR collection command', async () => {
    for (const [typeId, profileId] of [
      [587, regional],
      [44992, plex],
    ] as const) {
      resetMarketGraphQLFixture()
      const html = await $fetch<string>(url(typeId, profileId, 'history'))
      expect(html).toContain('aria-label="Daily price history"')
      expect(operations().toSorted((left, right) => left.localeCompare(right))).toEqual([
        'MarketHistory',
        'MarketItem',
        'MarketProfiles',
      ])
      expect(
        marketFixtureHttpRequests.filter(
          ({ path, method }) => method === 'POST' && path.includes('/history-intent/'),
        ),
      ).toHaveLength(0)
      const { page, hydrationWarnings, browserReads } = await openPage(
        url(typeId, profileId, 'history'),
      )
      try {
        await page.locator('canvas[aria-label^="Daily regional price history"]').waitFor()
        await page.waitForLoadState('networkidle')
        expect(browserReads).toEqual([])
        expect(operations().toSorted((left, right) => left.localeCompare(right))).toEqual([
          'MarketHistory',
          'MarketItem',
          'MarketProfiles',
        ])
        expect(hydrationWarnings).toEqual([])
      } finally {
        await page.close()
      }
    }
  })

  it('leaves uncollected books without initial side reads and keeps browse-only links free of selected resources', async () => {
    resetMarketGraphQLFixture()
    await domain({ book: 'uncollected' })
    try {
      const html = await $fetch<string>(url(587))
      expect(html).toContain('No complete order observation has been collected')
      expect(html).not.toContain('Market order source is unavailable')
      expect(html).not.toContain('Order source is unavailable')
      expect(html).not.toContain('showing the last loaded coverage and observation')
      expect(operations()).not.toContain('MarketInitialOrders')
      resetMarketGraphQLFixture()
      await $fetch<string>('/market')
      expect(operations()).toEqual(['MarketProfiles'])
    } finally {
      await domain({ book: 'complete' })
    }
  })

  it('preserves a successful seller alias and unknown buyer summary on partial failure', async () => {
    resetMarketGraphQLFixture()
    await state({ failSide: true })
    const page = await createPage(url(587))
    try {
      await page.getByRole('region', { name: 'Sellers' }).locator('tbody tr').first().waitFor()
      await page
        .getByRole('region', { name: 'Buyers' })
        .getByText('Buyers are unavailable.')
        .waitFor()
      expect(await page.locator('.market-book-summary__units').innerText()).toContain('— buy')
      expect(await page.getByRole('region', { name: 'Sellers' }).locator('tbody tr').count()).toBe(
        2,
      )
      expect(
        marketFixtureRequests.filter((request) =>
          request.query.includes('query MarketInitialOrders'),
        ),
      ).toHaveLength(1)
    } finally {
      await page.close()
      await state({})
    }
  })

  it('follows opaque pages with keyboard and mobile controls, returns to first rows, and restarts a retained-observation failure', async () => {
    resetMarketGraphQLFixture()
    const page = await createPage(url(40520))
    try {
      await page.setViewportSize({ width: 390, height: 844 })
      const sellers = page.getByRole('region', { name: 'Sellers' })
      await sellers.getByText('Showing 1–100 sellers orders.').waitFor()
      const scroll = sellers.locator('.market-order-table__scroll')
      const next = sellers.getByRole('button', { name: 'Next orders' })
      await next.focus()
      await next.press('Enter')
      await sellers.getByText('Showing 101–103 sellers orders.').waitFor()
      expect(
        marketFixtureRequests.find((request) =>
          request.query.includes('query MarketOrderContinuation'),
        )?.variables.after,
      ).toBe('fixture-opaque-page-two')
      const previous = sellers.getByRole('button', { name: 'Previous orders' })
      await previous.focus()
      await previous.press('Enter')
      await sellers.getByText('Showing 1–100 sellers orders.').waitFor()
      await state({ expiredObservation: true })
      // A new browser page starts without the successful continuation cached by this journey.
      await page.reload({ waitUntil: 'networkidle' })
      await scroll.evaluate((element) => {
        element.scrollTop = element.scrollHeight
        element.dispatchEvent(new Event('scroll'))
      })
      await sellers
        .getByRole('button', { name: 'Restart with the latest market observation' })
        .waitFor()
      expect(await sellers.locator('tbody tr').count()).toBe(0)
      await state({})
      await sellers
        .getByRole('button', { name: 'Restart with the latest market observation' })
        .click()
      await sellers.getByText('Showing 1–100 sellers orders.').waitFor()
    } finally {
      await page.close()
      await state({})
    }
  })

  it('keeps history-only SSR separate from reads and accepts the explicit ready command on mount', async () => {
    resetMarketGraphQLFixture()
    await domain({ history: 'uncollected' })
    await state({ demandReady: true })
    const html = await $fetch<string>(url(587, regional, 'history'))
    expect(html).toContain('Price History')
    expect(marketFixtureHttpRequests.some(({ path }) => path.includes('/history-intent/'))).toBe(
      false,
    )
    resetMarketGraphQLFixture()
    await state({ demandReady: true })
    const page = await createPage(url(587, regional, 'history'))
    try {
      await page.locator('canvas[aria-label^="Daily regional price history"]').waitFor()
      expect(operations()).not.toContain('MarketBook')
      expect(operations().filter((operation) => operation === 'MarketHistory')).toHaveLength(1)
      expect(
        marketFixtureHttpRequests.filter(
          ({ path, method }) => method === 'POST' && path.includes('/history-intent/'),
        ),
      ).toHaveLength(1)
    } finally {
      await page.close()
      await domain({ history: 'complete' })
      await state({})
    }
  })
  it('reports an HTTP 400 initial-order rejection without REST fallback or empty-success copy', async () => {
    resetMarketGraphQLFixture()
    const page = await createPage(url(44992, plex))
    try {
      await page.getByRole('region', { name: 'Sellers' }).locator('tbody tr').first().waitFor()
      await state({ rejectDocument: 'MarketInitialOrders' })
      await page.locator('#market-item-search').fill('Rift')
      await page.getByRole('button', { name: 'Rifter', exact: true }).click()
      await page.getByRole('heading', { name: 'Rifter', exact: true }).waitFor()
      await page.getByText('Market order source is unavailable', { exact: true }).waitFor()
      await page.waitForLoadState('networkidle')
      expect(
        marketFixtureRequests.filter(
          ({ query, variables }) =>
            query.includes('query MarketInitialOrders') && variables.typeId === '587',
        ),
      ).toHaveLength(1)
      expect(marketFixtureHttpRequests.some(({ path }) => path.includes('/books/'))).toBe(false)
      expect(await page.getByText('No orders in this ESI regional observation.').count()).toBe(0)
      expect(
        await page
          .getByText('No complete order observation has been collected for this item and market.')
          .count(),
      ).toBe(0)
    } finally {
      await page.close()
      await state({})
    }
  })

  it('discards a delayed prior market while switching profiles and PLEX eligibility through search', async () => {
    resetMarketGraphQLFixture()
    const page = await createPage(url(44992, plex))
    try {
      await page.getByRole('region', { name: 'Sellers' }).locator('tbody tr').first().waitFor()
      await state({ delayedType: '587', delayMs: 700 })
      await page.locator('#market-item-search').fill('Rift')
      await page.getByRole('button', { name: 'Rifter', exact: true }).click()
      const markets = page.getByRole('combobox', { name: 'Supported market' })
      await markets.waitFor()
      const domainProfile = '00000000-0000-4000-8000-000000000003'
      const pendingDomain = page.waitForRequest(
        (request) =>
          request.url().endsWith('/api/graphql') &&
          request.postData()?.includes(domainProfile) === true,
      )
      await markets.selectOption(domainProfile)
      await pendingDomain
      expect(await markets.inputValue()).toBe(domainProfile)
      await page.locator('#market-item-search').fill('PLEX')
      await page.getByRole('button', { name: 'PLEX', exact: true }).click()
      await page.getByRole('heading', { name: 'PLEX', exact: true }).waitFor()
      await page.waitForLoadState('networkidle')
      expect(await page.getByRole('region', { name: 'Sellers' }).innerText()).toContain(
        '4,921,000.00',
      )
      expect(await markets.count()).toBe(0)
      expect(new URL(page.url()).searchParams.get('profileId')).toBe(plex)
      expect(
        marketFixtureRequests.some(
          ({ query, variables }) =>
            query.includes('query MarketBook') && variables.profileId === domainProfile,
        ),
      ).toBe(true)
    } finally {
      await page.close()
      await state({})
    }
  })

  it('completes an accepted queued history command through bounded GraphQL polling', async () => {
    resetMarketGraphQLFixture()
    await domain({ history: 'uncollected' })
    await state({ demandAccepted: true })
    const page = await createPage(url(587, regional, 'history'))
    try {
      await page.getByText('Waiting for daily price history', { exact: true }).waitFor()
      await page.locator('canvas[aria-label^="Daily regional price history"]').waitFor()
      expect(operations().filter((name) => name === 'MarketHistory')).toHaveLength(3)
      expect(operations()).not.toContain('MarketBook')
      expect(
        marketFixtureHttpRequests.filter(
          ({ path, method }) => method === 'POST' && path.includes('/history-intent/'),
        ),
      ).toHaveLength(1)
      expect(
        marketFixtureHttpRequests.some(({ path }) => path.includes('/market/history/profiles/')),
      ).toBe(false)
    } finally {
      await page.close()
      await domain({ history: 'complete' })
      await state({})
    }
  })
})
