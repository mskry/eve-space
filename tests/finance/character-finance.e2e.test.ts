// @vitest-environment node

import { $fetch, createPage, setup, useTestContext } from '@nuxt/test-utils/e2e'
import type { Locator, Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
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
        configured: true,
        loginUrl: `${apiOrigin}/auth/eve/login`,
        attachUrl: `${apiOrigin}/auth/eve/attach`,
      },
    }
  }
  if (url.pathname === '/auth/session') {
    return {
      body: {
        authenticated: true,
        account: {
          userId: 'finance-e2e-user',
          mainCharacter: { characterId, name: 'Ledger Pilot' },
        },
      },
    }
  }
  if (url.pathname === '/api/admin/session') return { body: { authenticated: false } }
  if (url.pathname === '/api/modules') {
    return {
      body: {
        enabledModuleIds: [],
        shellNavigationOrder: {
          dashboard: [],
          character: [
            { ownerId: 'core', navigationId: 'core-character-overview' },
            { ownerId: 'core', navigationId: 'core-character-skills' },
            { ownerId: 'core', navigationId: 'core-character-finance' },
            { ownerId: 'core', navigationId: 'core-character-history' },
            { ownerId: 'core', navigationId: 'core-character-mail' },
          ],
        },
      },
    }
  }
  if (url.pathname === '/api/me/characters') {
    return { body: { characters: [ownedCharacter()] } }
  }
  if (url.pathname === `/api/me/characters/${characterId}/wallet`) {
    return { body: { characterId, balance: 9_876_543.21, ...metadata() } }
  }
  if (url.pathname === `/api/me/characters/${characterId}/wallet/journal`) {
    const page = Number(url.searchParams.get('page'))
    return {
      body: {
        characterId,
        entries:
          apiMode === 'empty-failed'
            ? []
            : [journalEntry(page * 10 + 1, page === 1 ? 'Market escrow' : 'Mission reward')],
        page,
        totalPages: 3,
        ...metadata(),
      },
    }
  }
  if (url.pathname === `/api/me/characters/${characterId}/wallet/transactions`) {
    const fromId = url.searchParams.get('fromId')
    return {
      body: {
        characterId,
        transactions:
          apiMode === 'empty-failed'
            ? []
            : fromId
              ? [transaction(899, 34, 'Older Tritanium')]
              : Array.from({ length: 28 }, (_, index) =>
                  transaction(1_100 - index, index === 1 ? 999_999 : 34, transactionName(index)),
                ),
        fromId: fromId ? Number(fromId) : null,
        nextFromId: fromId ? null : 900,
        ...metadata(),
      },
    }
  }
  if (url.pathname === `/api/me/characters/${characterId}/market/orders`) {
    if (apiMode === 'partial') return scopeRequired('market orders')
    if (apiMode === 'empty-failed') {
      return {
        status: 502,
        body: { code: 'ESI_UNAVAILABLE', message: 'Open orders are temporarily unavailable.' },
      }
    }
    return {
      body: {
        characterId,
        orders: Array.from({ length: 20 }, (_, index) =>
          marketOrder(2_000 + index, index % 2 === 0 ? 35 : 34, index % 2 === 0),
        ),
        ...metadata(),
      },
    }
  }
  if (url.pathname === `/api/me/characters/${characterId}/market/orders/history`) {
    if (apiMode === 'partial') return scopeRequired('order history')
    const page = Number(url.searchParams.get('page'))
    return {
      body: {
        characterId,
        orders:
          apiMode === 'empty-failed'
            ? []
            : Array.from({ length: 18 }, (_, index) => ({
                ...marketOrder(page * 10_000 + index, 36, false),
                state: index % 2 === 0 ? 'expired' : 'cancelled',
              })),
        page,
        totalPages: 2,
        ...metadata(),
      },
    }
  }
  if (url.pathname === `/api/me/characters/${characterId}/contracts`) {
    if (apiMode === 'partial') return scopeRequired('contracts')
    const page = Number(url.searchParams.get('page'))
    return {
      body: {
        characterId,
        contracts:
          apiMode === 'empty-failed'
            ? []
            : Array.from({ length: 16 }, (_, index) =>
                contract(page * 1_000 + index, index === 0 ? 'auction' : 'loan', index),
              ),
        page,
        totalPages: 2,
        ...metadata(),
      },
    }
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
            recordId: 301,
            typeId: 37,
            typeName: 'Mexallon',
            direction: 'included',
            quantity: 2,
            isSingleton: false,
            blueprint: null,
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
        characterId,
        contractId: Number(bidMatch[1]),
        bids: [{ bidId: 401, amount: 250_000, bidAt: '2026-09-02T11:30:00.000Z' }],
        ...metadata(),
      },
    }
  }
  const typeMatch = url.pathname.match(/^\/api\/universe\/types\/(\d+)$/)
  if (typeMatch) {
    const typeId = Number(typeMatch[1])
    if (typeId === 999_999) {
      return { status: 404, body: { code: 'TYPE_NOT_FOUND', message: 'Type not found.' } }
    }
    return {
      body: {
        typeId,
        name: typeId === 34 ? 'Tritanium' : typeId === 35 ? 'Pyerite' : 'Mexallon',
        description: 'Public static item detail.',
        group: { id: 18, name: 'Mineral' },
        category: { id: 4, name: 'Material' },
        detail: null,
      },
    }
  }

  return { status: 404, body: { code: 'NOT_FOUND', message: 'Not found.' } }
})

apiOrigin = apiServer.origin
process.env.NUXT_PUBLIC_API_BASE = apiOrigin
process.env.NUXT_PUBLIC_EVE_IMAGE_BASE = apiOrigin

afterAll(apiServer.close)

describe('character Finance production route', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    build: false,
    nuxtConfig: {
      nitro: { output: { dir: fileURLToPath(new URL('../../.output', import.meta.url)) } },
    },
    browser: true,
    server: true,
    captureServerLogs: false,
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
    await page.setViewportSize({ width: 1440, height: 900 })
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
      .getByRole('button', { name: 'OLDER', exact: true })
      .click()
    await page.getByText('Older Tritanium', { exact: true }).waitFor()
    expect(transactionRequests().at(-1)?.searchParams.get('fromId')).toBe('900')
    expect(transactionRequests().filter((url) => !url.searchParams.has('fromId'))).toHaveLength(
      newerRequestsBefore,
    )

    await openFinanceTab(page, 'Journal')
    const journalNext = servicePanel(page, 'Wallet journal').getByRole('button', {
      name: 'NEXT',
      exact: true,
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
      name: 'Open details for Auction lot 0',
      exact: true,
    })
    expect(contractDetailRequests()).toHaveLength(0)
    await auctionTrigger.click()
    const details = page.getByRole('dialog', { name: 'Auction lot 0', exact: true })
    await details.waitFor()
    const closeDetails = details.getByRole('button', {
      name: 'Close contract details',
      exact: true,
    })
    expect(await closeDetails.evaluate((element) => document.activeElement === element)).toBe(true)
    await waitForAnimations(details)
    const detailBox = await details.boundingBox()
    expect(detailBox).not.toBeNull()
    expect(detailBox!.width).toBeLessThanOrEqual(440)
    expect(Math.abs(detailBox!.x + detailBox!.width - 1440)).toBeLessThan(2)

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
    await page.setViewportSize({ width: 390, height: 844 })
    await openFinanceTab(page, 'Orders')
    const ordersPanel = servicePanel(page, 'Market orders')
    const historyMode = ordersPanel.getByRole('button', { name: 'Order history', exact: true })
    await historyMode.focus()
    await page.keyboard.press('Enter')
    await ordersPanel.getByText('Scordite', { exact: true }).first().waitFor()
    const sellFilter = ordersPanel.getByRole('button', { name: 'Sell', exact: true })
    await sellFilter.click()
    const historyNext = ordersPanel.getByRole('button', { name: 'NEXT', exact: true })
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
      name: 'Open details for Auction lot 0',
      exact: true,
    })
    await auctionTrigger.focus()
    await page.keyboard.press('Enter')
    const details = page.getByRole('dialog', { name: 'Auction lot 0', exact: true })
    await details.waitFor()
    await waitForAnimations(details)
    const detailBox = await details.boundingBox()
    expect(detailBox).not.toBeNull()
    expect(Math.abs(detailBox!.x)).toBeLessThan(2)
    expect(Math.abs(detailBox!.width - 390)).toBeLessThan(2)

    await details.getByRole('button', { name: 'Close contract details', exact: true }).click()
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
    expect(typeDetailRequests().map((url) => url.pathname)).toEqual(['/api/universe/types/34'])
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
        .getByRole('button', { name: 'NEXT', exact: true })
        .isEnabled(),
    ).toBe(true)
    await openFinanceTab(page, 'Transactions')
    await servicePanel(page, 'Market transactions')
      .getByRole('heading', { name: 'Transaction range empty' })
      .waitFor()
    expect(
      await servicePanel(page, 'Market transactions')
        .getByRole('button', { name: 'OLDER', exact: true })
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
  return page.getByRole('region', { name: title, exact: true })
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
    status: 403,
    body: {
      code: 'EVE_SCOPE_REQUIRED',
      message: `Authorize ${resource} for this character.`,
      requiredScope: 'required.scope.v1',
      authorizeUrl: `${apiOrigin}/auth/eve/reauthorize/${characterId}`,
    },
  }
}

function metadata() {
  return {
    cachedUntil: '2026-09-02T13:00:00.000Z',
    validatedAt: '2026-09-02T12:00:00.000Z',
    stale: false,
  }
}

function journalEntry(journalId: number, description: string) {
  return {
    journalId,
    date: '2026-09-02T11:00:00.000Z',
    amount: 50,
    balance: 1_000,
    referenceType: 'market_transaction',
    description,
    reason: null,
    taxAmount: null,
    context: null,
  }
}

function transaction(transactionId: number, typeId: number, typeName: string) {
  return {
    transactionId,
    journalRefId: transactionId + 10,
    date: '2026-09-02T11:00:00.000Z',
    typeId,
    typeName,
    quantity: 5,
    unitPrice: 10,
    totalPrice: 50,
    isBuy: transactionId % 2 === 0,
    locationId: 60_000_001,
  }
}

function transactionName(index: number) {
  if (index === 1) return 'Unknown type 999999'
  return `Tritanium batch ${index}`
}

function marketOrder(orderId: number, typeId: number, isBuy: boolean) {
  return {
    orderId,
    typeId,
    typeName: typeId === 35 ? 'Pyerite' : typeId === 36 ? 'Scordite' : 'Tritanium',
    isBuy,
    price: 100,
    volumeRemain: 10,
    volumeTotal: 20,
    minimumVolume: null,
    escrow: null,
    range: 'station',
    locationId: 60_000_001,
    regionId: 10_000_002,
    issuedAt: '2026-09-01T10:00:00.000Z',
    durationDays: 30,
    expiresAt: '2026-10-01T10:00:00.000Z',
  }
}

function contract(contractId: number, type: string, index: number) {
  return {
    contractId,
    type,
    status: 'outstanding',
    availability: 'personal',
    role: type === 'auction' ? 'assigned' : 'issued',
    title: type === 'auction' ? `Auction lot ${index}` : `Loan terms ${index}`,
    issuedAt: '2026-09-01T10:00:00.000Z',
    expiredAt: '2026-09-08T10:00:00.000Z',
    acceptedAt: null,
    completedAt: null,
    daysToComplete: null,
    startLocationId: 60_000_001,
    endLocationId: null,
    price: 100,
    reward: null,
    collateral: null,
    buyout: type === 'auction' ? 200 : null,
    volume: 5,
  }
}

function ownedCharacter() {
  return {
    characterId,
    name: 'Ledger Pilot',
    corporationId: 98_000_001,
    allianceId: null,
    isMain: true,
    birthday: '2020-01-01T00:00:00.000Z',
    securityStatus: 1.2,
    raceFactionId: 500_001,
    location: { solarSystemId: 30_000_142, solarSystemName: 'Jita' },
    ship: { typeId: 670, typeName: 'Capsule', name: 'Ledger One' },
    walletBalance: 9_876_543.21,
    totalSp: 5_000_000,
    corporation: { id: 98_000_001, name: 'Ledger Corporation' },
    alliance: null,
  }
}
