// @vitest-environment node

import { $fetch, createPage, setup, useTestContext } from '@nuxt/test-utils/e2e'
import type { Locator, Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cacheAdmissionForCharacter } from '../support/cache-admission'
import { startCorsJsonApi } from '../support/cors-json-api'

type ApiMode = 'data' | 'empty-failed' | 'partial'

const characterId = 7
const recordedRequests: URL[] = []
let apiMode: ApiMode = 'data'
let apiOrigin = ''

const apiServer = await startCorsJsonApi((request) => {
  const url = new URL(request.url ?? '/', 'http://mock-api.invalid')
  recordedRequests.push(url)

  if (url.pathname === '/auth/config') {
    return {
      body: {
        attachUrl: `${apiOrigin}/auth/eve/attach`,
        configured: true,
        loginUrl: `${apiOrigin}/auth/eve/login`,
      },
    }
  }
  if (url.pathname === '/auth/session') {
    return {
      body: {
        account: {
          mainCharacter: { characterId, name: 'Ledger Pilot' },
          userId: 'finance-e2e-user',
        },
        authenticated: true,
      },
    }
  }
  if (url.pathname === '/api/me/cache-admission') {
    return { body: cacheAdmissionForCharacter('finance-e2e-user', characterId) }
  }
  if (url.pathname === '/api/admin/session') {
    return { body: { authenticated: false } }
  }
  if (url.pathname === '/api/modules') {
    return {
      body: {
        enabledModuleIds: [],
        shellNavigationOrder: {
          character: [
            { ownerId: 'core', navigationId: 'core-character-overview' },
            { ownerId: 'core', navigationId: 'core-character-skills' },
            { ownerId: 'core', navigationId: 'core-character-finance' },
            { ownerId: 'core', navigationId: 'core-character-history' },
            { ownerId: 'core', navigationId: 'core-character-mail' },
          ],
          dashboard: [],
        },
      },
    }
  }
  if (url.pathname === '/api/me/characters') {
    return { body: { characters: [ownedCharacter()] } }
  }
  if (url.pathname === `/api/me/characters/${characterId}/wallet`) {
    return { body: { balance: 9_876_543.21, characterId, ...metadata() } }
  }
  if (url.pathname === `/api/me/characters/${characterId}/wallet/journal`) {
    return journalApiResponse(url)
  }
  if (url.pathname === `/api/me/characters/${characterId}/wallet/transactions`) {
    return transactionsApiResponse(url)
  }
  if (url.pathname === `/api/me/characters/${characterId}/market/orders`) {
    if (apiMode === 'partial') {
      return scopeRequired('market orders')
    }
    if (apiMode === 'empty-failed') {
      return {
        body: { code: 'ESI_UNAVAILABLE', message: 'Open orders are temporarily unavailable.' },
        status: 502,
      }
    }
    return {
      body: {
        characterId,
        orders: Array.from({ length: 20 }, (_, index) =>
          marketOrder(2000 + index, index % 2 === 0 ? 35 : 34, index % 2 === 0),
        ),
        ...metadata(),
      },
    }
  }
  if (url.pathname === `/api/me/characters/${characterId}/market/orders/history`) {
    return orderHistoryApiResponse(url)
  }
  if (url.pathname === `/api/me/characters/${characterId}/contracts`) {
    return contractsApiResponse(url)
  }
  const itemMatch = url.pathname.match(
    new RegExp(`^/api/me/characters/${characterId}/contracts/(\\d+)/items$`),
  )
  if (itemMatch) {
    return {
      body: {
        characterId,
        contractId: Number(itemMatch[1]),
        items: [
          {
            blueprint: null,
            direction: 'included',
            isSingleton: false,
            quantity: 2,
            recordId: 301,
            typeId: 37,
            typeName: 'Mexallon',
          },
        ],
        ...metadata(),
      },
    }
  }
  const bidMatch = url.pathname.match(
    new RegExp(`^/api/me/characters/${characterId}/contracts/(\\d+)/bids$`),
  )
  if (bidMatch) {
    return {
      body: {
        bids: [{ bidId: 401, amount: 250_000, bidAt: '2026-09-02T11:30:00.000Z' }],
        characterId,
        contractId: Number(bidMatch[1]),
        ...metadata(),
      },
    }
  }
  const typeMatch = url.pathname.match(/^\/api\/universe\/types\/(\d+)$/)
  if (typeMatch) {
    return universeTypeApiResponse(Number(typeMatch[1]))
  }

  return { body: { code: 'NOT_FOUND', message: 'Not found.' }, status: 404 }
})

function contractsApiResponse(url: URL) {
  if (apiMode === 'partial') {
    return scopeRequired('contracts')
  }
  const page = Number(url.searchParams.get('page'))
  const contracts =
    apiMode === 'empty-failed'
      ? []
      : Array.from({ length: 16 }, (_, index) =>
          contract(page * 1000 + index, index === 0 ? 'auction' : 'loan', index),
        )
  return { body: { characterId, contracts, page, totalPages: 2, ...metadata() } }
}

function orderHistoryApiResponse(url: URL) {
  if (apiMode === 'partial') {
    return scopeRequired('order history')
  }
  const page = Number(url.searchParams.get('page'))
  const orders =
    apiMode === 'empty-failed'
      ? []
      : Array.from({ length: 18 }, (_, index) => ({
          ...marketOrder(page * 10_000 + index, 36, false),
          state: index % 2 === 0 ? 'expired' : 'cancelled',
        }))
  return { body: { characterId, orders, page, totalPages: 2, ...metadata() } }
}

function journalApiResponse(url: URL) {
  const page = Number(url.searchParams.get('page'))
  const description = page === 1 ? 'Market escrow' : 'Mission reward'
  const entries = apiMode === 'empty-failed' ? [] : [journalEntry(page * 10 + 1, description)]
  return {
    body: {
      characterId,
      entries,
      page,
      totalPages: 3,
      ...metadata(),
    },
  }
}

function transactionsApiResponse(url: URL) {
  const fromId = url.searchParams.get('fromId')
  return {
    body: {
      characterId,
      fromId: fromId ? Number(fromId) : null,
      nextFromId: fromId ? null : 900,
      transactions: transactionsForRequest(fromId),
      ...metadata(),
    },
  }
}

function transactionsForRequest(fromId: string | null) {
  if (apiMode === 'empty-failed') {
    return []
  }
  if (fromId) {
    return [transaction(899, 34, 'Older Tritanium')]
  }
  return Array.from({ length: 28 }, (_, index) =>
    transaction(1100 - index, index === 1 ? 999_999 : 34, transactionName(index)),
  )
}

function universeTypeApiResponse(typeId: number) {
  if (typeId === 999_999) {
    return { body: { code: 'TYPE_NOT_FOUND', message: 'Type not found.' }, status: 404 }
  }
  let name = 'Mexallon'
  if (typeId === 34) {
    name = 'Tritanium'
  } else if (typeId === 35) {
    name = 'Pyerite'
  }
  return {
    body: {
      category: { id: 4, name: 'Material' },
      description: 'Public static item detail.',
      detail: null,
      group: { id: 18, name: 'Mineral' },
      name,
      typeId,
    },
  }
}

apiOrigin = apiServer.origin
process.env.NUXT_PUBLIC_API_BASE = apiOrigin
process.env.NUXT_PUBLIC_EVE_IMAGE_BASE = apiOrigin

afterAll(apiServer.close)

describe('character Finance production route', async () => {
  await setup({
    browser: true,
    build: false,
    captureServerLogs: false,
    nuxtConfig: {
      nitro: { output: { dir: fileURLToPath(new URL('../../.output-e2e', import.meta.url)) } },
    },
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    server: true,
    setupTimeout: 120_000,
  })

  const openPages = new Set<Page>()

  beforeEach(() => {
    apiMode = 'data'
    recordedRequests.length = 0
    apiServer.setAllowedOrigin(useTestContext().url)
  })

  afterEach(async () => {
    await Promise.all(Array.from(openPages, (page) => page.close()))
    openPages.clear()
  })

  it('keeps Finance private during SSR and serves the former Wallet URL as a normal 404', async () => {
    const html = await $fetch(`/characters/${characterId}/finance`)
    expect(html).toContain('Verifying account identity...')
    expect(financeRequests()).toHaveLength(0)

    await expect($fetch(`/characters/${characterId}/wallet`)).rejects.toMatchObject({
      statusCode: 404,
    })
    const page = await openPage(`/characters/${characterId}/wallet`)
    expect(new URL(page.url()).pathname).toBe(`/characters/${characterId}/wallet`)
    expect(await page.locator('body').textContent()).toMatch(/404|page not found/i)
    expect(financeRequests()).toHaveLength(0)
  })

  it('renders long desktop lists, bounded pagination, and contract drill-down geometry', async () => {
    const page = await openPage(`/characters/${characterId}/finance`)
    await page.setViewportSize({ height: 900, width: 1440 })
    await page
      .locator('.character-summary-card h2')
      .filter({ hasText: '9,876,543.21 ISK' })
      .waitFor()
    await servicePanel(page, 'Wallet journal').getByText('Market escrow', { exact: true }).waitFor()
    expect(transactionRequests()).toHaveLength(0)
    expect(openOrderRequests()).toHaveLength(0)
    expect(historyRequests()).toHaveLength(0)
    expect(contractRequests()).toHaveLength(0)

    await openFinanceTab(page, 'Transactions')
    await servicePanel(page, 'Market transactions')
      .getByText('Tritanium batch 0', { exact: true })
      .waitFor()
    expect(
      await servicePanel(page, 'Market transactions')
        .locator('.finance-table--transactions tbody tr')
        .count(),
    ).toBe(28)

    const newerRequestsBefore = transactionRequests().filter(
      (url) => !url.searchParams.has('fromId'),
    ).length
    await servicePanel(page, 'Market transactions')
      .getByRole('button', { exact: true, name: 'OLDER' })
      .click()
    await page.getByText('Older Tritanium', { exact: true }).waitFor()
    expect(transactionRequests().at(-1)?.searchParams.get('fromId')).toBe('900')
    expect(transactionRequests().filter((url) => !url.searchParams.has('fromId'))).toHaveLength(
      newerRequestsBefore,
    )

    await openFinanceTab(page, 'Journal')
    const journalNext = servicePanel(page, 'Wallet journal').getByRole('button', {
      exact: true,
      name: 'NEXT',
    })
    await journalNext.focus()
    await page.keyboard.press('Enter')
    await servicePanel(page, 'Wallet journal')
      .locator('.finance-footer-scope')
      .filter({ hasText: 'PAGE 2 / 3' })
      .waitFor()
    expect(journalRequests().at(-1)?.searchParams.get('page')).toBe('2')

    await openFinanceTab(page, 'Orders')
    await servicePanel(page, 'Market orders')
      .getByText('Pyerite', { exact: true })
      .first()
      .waitFor()
    expect(
      await servicePanel(page, 'Market orders').locator('.finance-table--orders tbody tr').count(),
    ).toBe(20)
    expect(historyRequests()).toHaveLength(0)

    await openFinanceTab(page, 'Contracts')
    await servicePanel(page, 'Character contracts')
      .getByText('Auction lot 0', { exact: true })
      .waitFor()
    expect(
      await servicePanel(page, 'Character contracts').locator('.finance-contract-row').count(),
    ).toBe(16)

    const auctionTrigger = contractRow(page, 'Auction lot 0').getByRole('button', {
      exact: true,
      name: 'Open details for Auction lot 0',
    })
    expect(contractDetailRequests()).toHaveLength(0)
    await auctionTrigger.click()
    const details = page.getByRole('dialog', { exact: true, name: 'Auction lot 0' })
    await details.waitFor()
    const closeDetails = details.getByRole('button', {
      exact: true,
      name: 'Close contract details',
    })
    expect(await closeDetails.evaluate((element) => document.activeElement === element)).toBe(true)
    await waitForAnimations(details)
    const detailBox = await details.boundingBox()
    const overlayBox = await page.locator('.ui-drawer-overlay').boundingBox()
    expect(detailBox).not.toBeNull()
    expect(overlayBox).not.toBeNull()
    expect(detailBox!.width).toBeLessThanOrEqual(440)
    expect(
      Math.abs(detailBox!.x + detailBox!.width - (overlayBox!.x + overlayBox!.width)),
    ).toBeLessThan(2)

    await details.getByText('Mexallon', { exact: true }).waitFor()
    await details.getByText('250,000 ISK', { exact: true }).waitFor()
    expect(
      contractDetailRequests().every((url) => url.searchParams.get('contractPage') === '1'),
    ).toBe(true)
    await closeDetails.click()
    expect(await auctionTrigger.evaluate((element) => document.activeElement === element)).toBe(
      true,
    )
    expect(await hasHorizontalOverflow(page)).toBe(false)
  })

  it('keeps keyboard controls, item popovers, drill-downs, and document width usable on mobile', async () => {
    const page = await openPage(`/characters/${characterId}/finance`)
    await page.setViewportSize({ height: 844, width: 390 })
    await openFinanceTab(page, 'Orders')
    const ordersPanel = servicePanel(page, 'Market orders')
    const historyMode = ordersPanel.getByRole('button', { exact: true, name: 'Order history' })
    await historyMode.focus()
    await page.keyboard.press('Enter')
    await ordersPanel.getByText('Scordite', { exact: true }).first().waitFor()
    const sellFilter = ordersPanel.getByRole('button', { exact: true, name: 'Sell' })
    await sellFilter.click()
    const historyNext = ordersPanel.getByRole('button', { exact: true, name: 'NEXT' })
    await historyNext.focus()
    await page.keyboard.press('Enter')
    expect(historyRequests().at(-1)?.searchParams.get('page')).toBe('2')
    expect(await historyMode.getAttribute('aria-pressed')).toBe('true')
    expect(await sellFilter.getAttribute('aria-pressed')).toBe('true')

    await openFinanceTab(page, 'Contracts')
    await servicePanel(page, 'Character contracts')
      .getByText('Auction lot 0', { exact: true })
      .waitFor()
    const auctionTrigger = contractRow(page, 'Auction lot 0').getByRole('button', {
      exact: true,
      name: 'Open details for Auction lot 0',
    })
    await auctionTrigger.focus()
    await page.keyboard.press('Enter')
    const details = page.getByRole('dialog', { exact: true, name: 'Auction lot 0' })
    await details.waitFor()
    await waitForAnimations(details)
    const detailBox = await details.boundingBox()
    const overlayBox = await page.locator('.ui-drawer-overlay').boundingBox()
    expect(detailBox).not.toBeNull()
    expect(overlayBox).not.toBeNull()
    expect(
      Math.abs(detailBox!.x + detailBox!.width - (overlayBox!.x + overlayBox!.width)),
    ).toBeLessThan(2)
    expect(Math.abs(detailBox!.width - page.viewportSize()!.width)).toBeLessThan(2)

    await details.getByRole('button', { exact: true, name: 'Close contract details' }).click()
    await details.waitFor({ state: 'detached' })

    await openFinanceTab(page, 'Transactions')
    const itemTrigger = servicePanel(page, 'Market transactions').getByRole('button', {
      name: 'View item information for Tritanium batch 0',
    })
    await itemTrigger.hover()
    expect(typeDetailRequests()).toHaveLength(0)
    const financeCount = financeRequests().length
    await itemTrigger.focus()
    await page.keyboard.press('Enter')
    const dialog = page.locator('.eve-item-information-popover[role="dialog"]')
    await dialog.getByRole('heading', { name: 'Tritanium' }).waitFor()
    expect(typeDetailRequests().map((url) => url.pathname)).toStrictEqual([
      '/api/universe/types/34',
    ])
    expect(financeRequests()).toHaveLength(financeCount)
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    expect(await itemTrigger.evaluate((element) => document.activeElement === element)).toBe(true)
    expect(financeRequests()).toHaveLength(financeCount)
    expect(await hasHorizontalOverflow(page)).toBe(false)
  })

  it('keeps wallet services usable when market and contract scopes are absent', async () => {
    apiMode = 'partial'
    const page = await openPage(`/characters/${characterId}/finance`)
    await servicePanel(page, 'Wallet journal').getByText('Market escrow', { exact: true }).waitFor()
    await openFinanceTab(page, 'Transactions')
    await servicePanel(page, 'Market transactions')
      .getByText('Tritanium batch 0', { exact: true })
      .waitFor()
    for (const [tab, title] of [
      ['Orders', 'Market orders'],
      ['Contracts', 'Character contracts'],
    ] as const) {
      await openFinanceTab(page, tab)
      await servicePanel(page, title)
        .getByRole('heading', { name: `${title} not authorized` })
        .waitFor()
      expect(
        await servicePanel(page, title)
          .getByRole('link', { name: 'AUTHORIZE THIS CHARACTER' })
          .getAttribute('href'),
      ).toBe(`${apiOrigin}/auth/eve/reauthorize/${characterId}`)
    }
    expect(historyRequests()).toHaveLength(0)
    expect(
      await page
        .locator('.character-summary-card h2')
        .filter({ hasText: '9,876,543.21 ISK' })
        .isVisible(),
    ).toBe(true)
  })

  it('preserves sparse navigation and sibling panels for representative empty and failed services', async () => {
    apiMode = 'empty-failed'
    const page = await openPage(`/characters/${characterId}/finance`)
    await servicePanel(page, 'Wallet journal')
      .getByRole('heading', { name: 'Journal page empty' })
      .waitFor()
    expect(
      await servicePanel(page, 'Wallet journal')
        .getByRole('button', { exact: true, name: 'NEXT' })
        .isEnabled(),
    ).toBe(true)
    await openFinanceTab(page, 'Transactions')
    await servicePanel(page, 'Market transactions')
      .getByRole('heading', { name: 'Transaction range empty' })
      .waitFor()
    expect(
      await servicePanel(page, 'Market transactions')
        .getByRole('button', { exact: true, name: 'OLDER' })
        .isEnabled(),
    ).toBe(true)
    await openFinanceTab(page, 'Orders')
    await servicePanel(page, 'Market orders')
      .getByRole('heading', { name: 'Market orders unavailable' })
      .waitFor()
    await openFinanceTab(page, 'Contracts')
    await servicePanel(page, 'Character contracts')
      .getByRole('heading', { name: 'Contract page empty' })
      .waitFor()
    expect(
      await page
        .locator('.character-summary-card h2')
        .filter({ hasText: '9,876,543.21 ISK' })
        .isVisible(),
    ).toBe(true)
    expect(await hasHorizontalOverflow(page)).toBe(false)
  })

  async function openPage(path: string) {
    const page = await createPage(path)
    openPages.add(page)
    return page
  }
})

function servicePanel(page: Page, title: string): Locator {
  return page.getByRole('region', { exact: true, name: title })
}

function financeTab(page: Page, label: string): Locator {
  return page.getByRole('tab', {
    name: new RegExp(`^${label}(?:\\s+\\d+)?$`),
  })
}

async function openFinanceTab(page: Page, label: string) {
  await financeTab(page, label).click()
}

function contractRow(page: Page, title: string): Locator {
  return servicePanel(page, 'Character contracts')
    .locator('.finance-contract-row')
    .filter({ hasText: title })
}

function financeRequests() {
  const root = `/api/me/characters/${characterId}`
  return recordedRequests.filter(
    (url) =>
      url.pathname === `${root}/wallet` ||
      url.pathname === `${root}/wallet/journal` ||
      url.pathname === `${root}/wallet/transactions` ||
      url.pathname === `${root}/market/orders` ||
      url.pathname === `${root}/market/orders/history` ||
      url.pathname === `${root}/contracts` ||
      new RegExp(`^${root}/contracts/\\d+/(items|bids)$`).test(url.pathname),
  )
}

function transactionRequests() {
  return financeRequests().filter((url) => url.pathname.endsWith('/wallet/transactions'))
}

function journalRequests() {
  return financeRequests().filter((url) => url.pathname.endsWith('/wallet/journal'))
}

function openOrderRequests() {
  return financeRequests().filter((url) => url.pathname.endsWith('/market/orders'))
}

function historyRequests() {
  return financeRequests().filter((url) => url.pathname.endsWith('/market/orders/history'))
}

function contractRequests() {
  return financeRequests().filter((url) => url.pathname.endsWith('/contracts'))
}

function contractDetailRequests() {
  return financeRequests().filter((url) => /\/contracts\/\d+\/(items|bids)$/.test(url.pathname))
}

function typeDetailRequests() {
  return recordedRequests.filter((url) => url.pathname.startsWith('/api/universe/types/'))
}

async function hasHorizontalOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
}

async function waitForAnimations(locator: Locator) {
  await locator.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished))
  })
}

function scopeRequired(resource: string) {
  return {
    body: {
      authorizeUrl: `${apiOrigin}/auth/eve/reauthorize/${characterId}`,
      code: 'EVE_SCOPE_REQUIRED',
      message: `Authorize ${resource} for this character.`,
      requiredScope: 'required.scope.v1',
    },
    status: 403,
  }
}

function metadata() {
  return {
    cachedUntil: '2026-09-02T13:00:00.000Z',
    stale: false,
    validatedAt: '2026-09-02T12:00:00.000Z',
  }
}

function journalEntry(journalId: number, description: string) {
  return {
    amount: 50,
    balance: 1000,
    context: null,
    date: '2026-09-02T11:00:00.000Z',
    description,
    journalId,
    reason: null,
    referenceType: 'market_transaction',
    taxAmount: null,
  }
}

function transaction(transactionId: number, typeId: number, typeName: string) {
  return {
    date: '2026-09-02T11:00:00.000Z',
    isBuy: transactionId % 2 === 0,
    journalRefId: transactionId + 10,
    locationId: 60_000_001,
    quantity: 5,
    totalPrice: 50,
    transactionId,
    typeId,
    typeName,
    unitPrice: 10,
  }
}

function transactionName(index: number) {
  if (index === 1) {
    return 'Unknown type 999999'
  }
  return `Tritanium batch ${index}`
}

function marketOrder(orderId: number, typeId: number, isBuy: boolean) {
  return {
    durationDays: 30,
    escrow: null,
    expiresAt: '2026-10-01T10:00:00.000Z',
    isBuy,
    issuedAt: '2026-09-01T10:00:00.000Z',
    locationId: 60_000_001,
    minimumVolume: null,
    orderId,
    price: 100,
    range: 'station',
    regionId: 10_000_002,
    typeId,
    typeName: typeId === 35 ? 'Pyerite' : typeId === 36 ? 'Scordite' : 'Tritanium',
    volumeRemain: 10,
    volumeTotal: 20,
  }
}

function contract(contractId: number, type: string, index: number) {
  return {
    acceptedAt: null,
    availability: 'personal',
    buyout: type === 'auction' ? 200 : null,
    collateral: null,
    completedAt: null,
    contractId,
    daysToComplete: null,
    endLocationId: null,
    expiredAt: '2026-09-08T10:00:00.000Z',
    issuedAt: '2026-09-01T10:00:00.000Z',
    price: 100,
    reward: null,
    role: type === 'auction' ? 'assigned' : 'issued',
    startLocationId: 60_000_001,
    status: 'outstanding',
    title: type === 'auction' ? `Auction lot ${index}` : `Loan terms ${index}`,
    type,
    volume: 5,
  }
}

function ownedCharacter() {
  return {
    alliance: null,
    allianceId: null,
    birthday: '2020-01-01T00:00:00.000Z',
    characterId,
    corporation: { id: 98_000_001, name: 'Ledger Corporation' },
    corporationId: 98_000_001,
    isMain: true,
    location: { locationType: 'space', solarSystemId: 30_000_142, solarSystemName: 'Jita' },
    name: 'Ledger Pilot',
    raceFactionId: 500_001,
    securityStatus: 1.2,
    ship: { groupId: 29, name: 'Ledger One', typeId: 670, typeName: 'Capsule' },
    totalSp: 5_000_000,
    walletBalance: 9_876_543.21,
  }
}
