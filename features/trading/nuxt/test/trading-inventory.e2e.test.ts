// @vitest-environment node
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { $fetch, createPage, setup, url } from '@nuxt/test-utils/e2e'
import { expect as expectPage, type Page } from '@playwright/test'
import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { controls, fixture, requests } from './trading-browser-fixture'

const server = serve({ fetch: fixture.fetch, hostname: '127.0.0.1', port: 0 })
await once(server, 'listening')
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Expected a TCP fixture listener.')
process.env.NUXT_PUBLIC_API_BASE = `http://127.0.0.1:${address.port}`
afterAll(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
)
beforeEach(() => {
  Object.assign(controls, {
    reviewer: true,
    authenticated: true,
    admissionUnavailable: false,
    revision: 1,
    delay: 0,
    restart: false,
    disabled: false,
    empty: false,
    gap: 'authorization-required',
    limit: false,
  })
  requests.length = 0
})

const persistedRecords = (page: Page) =>
  page.evaluate(async () => {
    const databases = await indexedDB.databases()
    const records: unknown[] = []
    for (const database of databases) {
      if (!database.name) continue
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(database.name!)
        open.addEventListener('success', () => resolve(open.result), { once: true })
        open.addEventListener('error', () => reject(open.error), { once: true })
      })
      for (const store of db.objectStoreNames) {
        records.push(
          await new Promise((resolve, reject) => {
            const read = db.transaction(store).objectStore(store).getAll()
            read.addEventListener('success', () => resolve(read.result), { once: true })
            read.addEventListener('error', () => reject(read.error), { once: true })
          }),
        )
      }
      db.close()
    }
    return JSON.stringify(records)
  })

describe('Trading private inventory production journeys', async () => {
  await setup({
    browser: true,
    port: 3003,
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

  test('renders without protected SSR, hydrates several characters, and keeps inventory out of persisted cache', async () => {
    const html = await $fetch<string>('/trading', {
      headers: { cookie: 'unrelated=do-not-forward' },
    })
    expect(html).toContain('Trading inventory')
    expect(html).not.toContain('Tritanium')
    expect(
      requests.some(({ path }) => path === '/graphql' || path.startsWith('/api/inventory')),
    ).toBe(false)
    const page = await createPage()
    const warnings: string[] = []
    page.on('console', (message) => {
      if (message.text().toLowerCase().includes('hydration')) warnings.push(message.text())
    })
    page.on('pageerror', (error) => warnings.push(error.message))
    try {
      await page.goto(url('/__e2e/query-persistence?source=client'), { waitUntil: 'hydration' })
      await expectPage(page.getByTestId('public-value')).toHaveText(
        'Trading storage positive control',
      )
      await expectPage
        .poll(() => persistedRecords(page))
        .toContain('Trading storage positive control')
      await page.goto(url('/trading'), { waitUntil: 'hydration' })
      const rows = page.getByRole('table').locator('tbody tr')
      await expectPage(rows).toHaveCount(50)
      await expectPage(rows.first()).toContainText('12')
      await expectPage(rows.first()).toContainText('2')
      await expectPage(page.getByRole('heading', { name: 'Trading Pilot 9' })).toBeVisible()
      await expectPage(
        page.getByText('Assets authorization required', { exact: true }),
      ).toBeVisible()
      expect(
        requests
          .filter(({ path }) => path === '/graphql')
          .every(({ body }) => body?.variables?.characterIds === undefined),
      ).toBe(true)
      expect(warnings).toEqual([])
      const stored = await persistedRecords(page)
      expect(stored).toContain('Trading storage positive control')
      expect(stored).not.toContain('Tritanium')
      expect(stored).not.toContain('Trading depot')
    } finally {
      await page.close()
    }
  })

  test('supports keyboard filters and holder clocks, explicit empty selection, and isolated corporation switching', async () => {
    const page = await createPage('/trading')
    try {
      await expectPage(page.getByRole('table').locator('tbody tr')).toHaveCount(50)
      const type = page.getByLabel('Type ID', { exact: true })
      await type.focus()
      await type.fill('34')
      await type.press('Enter')
      await expectPage(page.getByRole('table').locator('tbody tr')).toHaveCount(1)
      const holders = page.getByRole('button', { name: 'Holders of Tritanium', exact: true })
      await holders.focus()
      await holders.press('Enter')
      await expectPage(page.getByRole('heading', { name: 'Holders of Tritanium' })).toBeVisible()
      await expectPage(
        page.getByRole('heading', { name: 'Holders of Tritanium' }).locator('..'),
      ).toContainText('2026-10-03T10:05:00.000Z')
      await page.getByLabel('All attached characters').uncheck()
      await expectPage(
        page.getByText('No matching item groups in the complete selected observations.', {
          exact: true,
        }),
      ).toBeVisible()
      await page.getByLabel('Trading Pilot 7', { exact: true }).check()
      await expectPage(page.getByRole('table').locator('tbody tr').first()).toContainText('5')
      controls.delay = 700
      const pending = page.waitForRequest(
        (request) =>
          request.url().endsWith('/graphql') &&
          request.postData()?.includes('TradingPersonalInventory') === true,
      )
      await page.getByLabel('Trading Pilot 8', { exact: true }).check()
      await pending
      await page.getByRole('combobox', { name: 'View', exact: true }).selectOption('98')
      await expectPage(page.getByRole('table').locator('tbody tr').first()).toContainText('55')
      await page.waitForLoadState('networkidle')
      await expectPage(page.getByRole('table').locator('tbody tr').first()).toContainText('55')
      expect(
        requests.some(({ body }) => body?.query?.includes('TradingCorporationInventory')),
      ).toBe(true)
    } finally {
      await page.close()
    }
  })

  test('suspends on unknown admission, recovers after verification, and clears known reviewer and session denial', async () => {
    const page = await createPage('/trading')
    try {
      await expectPage(page.getByRole('table').locator('tbody tr')).toHaveCount(50)
      controls.admissionUnavailable = true
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await expectPage(
        page.locator('output').filter({
          hasText: 'Verification unavailable. Inventory is hidden until access can be verified.',
        }),
      ).toBeVisible()
      await expectPage(page.getByRole('table')).toHaveCount(0)
      controls.admissionUnavailable = false
      await page.getByRole('button', { name: 'Verify and refresh inventory', exact: true }).click()
      await expectPage(page.getByRole('table').locator('tbody tr')).toHaveCount(50)
      await page.getByRole('combobox', { name: 'View', exact: true }).selectOption('98')
      await expectPage(page.getByRole('table').locator('tbody tr').first()).toContainText('55')
      controls.reviewer = false
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await expectPage(page.getByRole('table')).toHaveCount(0)
      await expectPage(page.getByRole('option', { name: 'Corporation 98' })).toHaveCount(0)
      await page.getByRole('combobox', { name: 'View', exact: true }).selectOption('personal')
      await expectPage(page.getByRole('table').locator('tbody tr')).toHaveCount(50)
      controls.authenticated = false
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await expectPage(page.getByRole('table')).toHaveCount(0)
    } finally {
      await page.close()
    }
  })

  test('refuses changed-source continuation and restarts from one current view', async () => {
    const page = await createPage('/trading')
    try {
      await expectPage(page.getByRole('table').locator('tbody tr')).toHaveCount(50)
      controls.restart = true
      await page.getByRole('button', { name: 'Next item groups' }).click()
      await expectPage(
        page.locator('output').filter({
          hasText:
            'The inventory source or authority changed. Restart to read one consistent view.',
        }),
      ).toBeVisible()
      await expectPage(page.getByRole('table')).toHaveCount(0)
      controls.restart = false
      controls.revision += 1
      await page.getByRole('button', { name: 'Restart inventory' }).click()
      await expectPage(page.getByRole('table').locator('tbody tr')).toHaveCount(50)
      await page.getByRole('button', { name: 'Next item groups' }).click()
      await expectPage(page.getByRole('table').locator('tbody tr')).toHaveCount(1)
    } finally {
      await page.close()
    }
  })
  test('distinguishes complete empty observations, availability and conflict gaps, and refuses limits without partial totals', async () => {
    controls.empty = true
    const page = await createPage('/trading')
    try {
      await expectPage(
        page.getByText('No matching item groups in the complete selected observations.', {
          exact: true,
        }),
      ).toBeVisible()
      await expectPage(
        page.getByText('All selected sources are complete.', { exact: false }),
      ).toBeVisible()
      controls.empty = false
      controls.gap = 'unavailable'
      await page.getByRole('button', { name: 'Verify and refresh inventory', exact: true }).click()
      await expectPage(
        page.getByText('Source unavailable; holdings unknown', { exact: true }),
      ).toBeVisible()
      await expectPage(page.getByRole('table').locator('tbody tr')).toHaveCount(50)
      controls.gap = 'conflicting-source'
      await page.getByRole('button', { name: 'Verify and refresh inventory', exact: true }).click()
      await expectPage(
        page.getByText('Conflicting item observations; disputed items excluded', { exact: true }),
      ).toBeVisible()
      controls.limit = true
      await page.getByRole('button', { name: 'Verify and refresh inventory', exact: true }).click()
      await expectPage(page.getByLabel('Inventory status', { exact: true })).toContainText(
        'Narrow your personal character selection',
      )
      await expectPage(page.getByRole('table')).toHaveCount(0)
    } finally {
      await page.close()
    }
  })
})
