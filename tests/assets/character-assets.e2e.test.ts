// @vitest-environment node

import { $fetch, createPage, setup, useTestContext } from '@nuxt/test-utils/e2e'
import type { Locator, Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startCorsJsonApi } from '../support/cors-json-api'

type ApiMode = 'current' | 'partial' | 'scope' | 'long'

const characterId = 7_001
const recordedRequests: URL[] = []
const longValue = 'LONG-ASSET-IDENTITY-WITHOUT-BREAKS-'.repeat(18)
let apiMode: ApiMode = 'current'
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
          userId: 'assets-e2e-user',
          mainCharacter: { characterId, name: 'Manifest Pilot' },
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
            { ownerId: 'core', navigationId: 'core-character-clones' },
            { ownerId: 'core', navigationId: 'core-character-finance' },
            { ownerId: 'core', navigationId: 'core-character-assets' },
            { ownerId: 'core', navigationId: 'core-character-history' },
            { ownerId: 'core', navigationId: 'core-character-mail' },
          ],
        },
      },
    }
  }
  if (url.pathname === '/api/me/characters') return { body: { characters: [ownedCharacter()] } }
  if (url.pathname === `/api/me/characters/${characterId}`) return { body: overviewResponse() }
  if (url.pathname === `/api/me/characters/${characterId}/assets`) {
    if (apiMode === 'scope') {
      return {
        status: 403,
        body: {
          code: 'EVE_SCOPE_REQUIRED',
          message: 'Grant esi-assets.read_assets.v1 for this character.',
          requiredScope: 'esi-assets.read_assets.v1',
          authorizeUrl: `${apiOrigin}/auth/eve/reauthorize/${characterId}?returnTo=%2Fcharacters%2F${characterId}%2Fassets`,
        },
      }
    }
    return { body: assetsResponse() }
  }
  const typeMatch = url.pathname.match(/^\/api\/universe\/types\/(\d+)$/)
  if (typeMatch) {
    const typeId = Number(typeMatch[1])
    return {
      body: {
        typeId,
        name: apiMode === 'long' ? longValue : `Inventory item ${typeId}`,
        description: `${apiMode === 'long' ? longValue : 'Public static item detail.'}\n\n${'Detail section. '.repeat(30)}`,
        group: { id: 12, name: 'Cargo Container' },
        category: { id: 65, name: 'Structure' },
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

describe('character Assets production route', async () => {
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
    apiMode = 'current'
    recordedRequests.length = 0
    apiServer.setAllowedOrigin(useTestContext().url)
  })

  afterEach(async () => {
    await Promise.all(Array.from(openPages, (page) => page.close()))
    openPages.clear()
  })

  it('keeps direct-route SSR private and does not prefetch inventory on navigation intent', async () => {
    const html = await $fetch(`/characters/${characterId}/assets`)
    expect(html).toContain('Verifying account identity...')
    expect(assetRequests()).toHaveLength(0)
    expect(html).not.toContain('Cargo vault')

    const page = await openPage(`/characters/${characterId}`)
    const navigation = page.getByRole('navigation', { name: 'Character record sections' })
    const assetsLink = navigation.getByRole('link', { name: 'ASSETS', exact: true })
    await assetsLink.waitFor()
    expect(await navigation.getByRole('link').allTextContents()).toEqual([
      'OVERVIEW',
      'SKILLS',
      'CLONES',
      'FINANCE',
      'ASSETS',
      'HISTORY',
      'MAIL',
    ])

    await assetsLink.hover()
    await assetsLink.focus()
    await expect
      .poll(() =>
        assetsLink.evaluate((element) => ({
          focused: document.activeElement === element,
          hovered: element.matches(':hover'),
        })),
      )
      .toEqual({ focused: true, hovered: true })
    expect(assetRequests()).toHaveLength(0)

    await assetsLink.click()
    await page.getByRole('heading', { name: '237 TOTAL ASSETS' }).waitFor()
    expect(assetRequests()).toHaveLength(1)
    expect(await assetsLink.getAttribute('aria-current')).toBe('page')
  })

  it('renders the complete collection through bounded desktop rows and nested search context', async () => {
    apiMode = 'partial'
    const page = await openPage(`/characters/${characterId}/assets`)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('heading', { name: '237 TOTAL ASSETS' }).waitFor()
    expect(await assetRows(page).count()).toBe(100)
    expect(
      await page.getByText('Inventory context is incomplete', { exact: true }).isVisible(),
    ).toBe(true)
    expect(await page.getByText('custom names: partial', { exact: true }).isVisible()).toBe(true)
    expect(
      await page.getByRole('table', { name: 'Personal inventory grouped by location' }).isVisible(),
    ).toBe(true)

    const quantitySort = page.getByRole('button', { name: 'Quantity', exact: true })
    await quantitySort.click()
    expect(await quantitySort.locator('..').getAttribute('aria-sort')).toBe('ascending')

    await page.locator('.assets-strip-filters').click()
    const typeFilter = page.getByRole('combobox', { name: 'Type filter' })
    await typeFilter.fill('Inventory item 2')
    await page.getByRole('option', { name: 'Inventory item 2', exact: true }).click()
    expect(await typeFilter.inputValue()).toBe('Inventory item 2')
    await expect.poll(() => assetRows(page).count()).toBe(2)
    await page.getByRole('button', { name: 'Clear type filter', exact: true }).click()

    const search = page.getByRole('searchbox', { name: 'Search text' })
    await search.fill('Dep scaner')
    await expect.poll(() => assetRows(page).count()).toBe(2)
    expect(await assetRow(page, 1).isVisible()).toBe(true)
    expect(await assetRow(page, 2).getAttribute('data-depth')).toBe('1')
    expect(await page.getByText('1 matches / 237 assets', { exact: false }).isVisible()).toBe(true)

    await search.fill('Inventory item')
    await expect.poll(() => assetRows(page).count()).toBe(100)
    await page.getByRole('button', { name: 'Next page' }).click()
    expect(await assetRows(page).count()).toBe(100)
    expect(await search.inputValue()).toBe('Inventory item')
    expect(await hasHorizontalOverflow(page)).toBe(false)
  })

  it('refreshes only Assets after exact-character reauthorization', async () => {
    const page = await openPage(`/characters/${characterId}/assets`)
    await page.getByRole('heading', { name: '237 TOTAL ASSETS' }).waitFor()
    const requestsBefore = assetRequests().length

    await page.evaluate(() => {
      history.pushState({}, '', `${location.pathname}?reauthorize=success`)
      dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
    })

    await page.getByText('Character authorization refreshed.', { exact: true }).waitFor()
    await expect.poll(() => assetRequests().length).toBeGreaterThan(requestsBefore)
    await expect.poll(() => new URL(page.url()).searchParams.has('reauthorize')).toBe(false)
  })

  it('presents exact-character scope recovery without retrying the protected collection', async () => {
    apiMode = 'scope'
    const page = await openPage(`/characters/${characterId}/assets`)
    const state = page.getByRole('alert')
    await state.getByRole('heading', { name: 'Asset authorization required' }).waitFor()
    expect(
      await state.getByText('Grant esi-assets.read_assets.v1 for this character.').isVisible(),
    ).toBe(true)
    expect(
      await state.getByRole('link', { name: 'AUTHORIZE ASSETS FOR THIS CHARACTER' }).isVisible(),
    ).toBe(true)
    expect(assetRequests()).toHaveLength(1)
  })

  it('keeps long mobile inventory and lazy item information within the viewport and restores focus', async () => {
    apiMode = 'long'
    const page = await openPage(`/characters/${characterId}/assets`)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('heading', { name: '237 TOTAL ASSETS' }).waitFor()
    const search = page.getByRole('searchbox', { name: 'Search text' })
    await search.fill(longValue.slice(0, 40))
    const longRow = assetRow(page, 3)
    await longRow.waitFor()
    const trigger = longRow.getByRole('button', {
      name: `View item information for ${longValue}`,
    })
    await trigger.hover()
    expect(typeDetailRequests()).toHaveLength(0)
    const assetsBefore = assetRequests().length
    await trigger.focus()
    await page.keyboard.press('Enter')

    const dialog = page.getByRole('dialog', { name: 'Item information' })
    await dialog.getByRole('heading', { name: longValue }).waitFor()
    await expect.poll(async () => isWithinViewport(await dialog.boundingBox(), 390, 844)).toBe(true)
    expect(typeDetailRequests().map((url) => url.pathname)).toEqual(['/api/universe/types/103'])
    expect(assetRequests()).toHaveLength(assetsBefore)
    expectWithinViewport(await dialog.boundingBox(), 390, 844)
    expect(await hasHorizontalOverflow(page)).toBe(false)

    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    expect(await trigger.evaluate((element) => document.activeElement === element)).toBe(true)
    expect(await search.inputValue()).toBe(longValue.slice(0, 40))
    expect(assetRequests()).toHaveLength(assetsBefore)
    expect(await hasHorizontalOverflow(page)).toBe(false)
  })

  async function openPage(path: string) {
    const page = await createPage(path)
    openPages.add(page)
    return page
  }
})

function assetRows(page: Page) {
  return page.locator('.assets-hierarchy-row')
}

function assetRow(page: Page, itemId: number): Locator {
  return page.locator(`[data-asset-item-id="${itemId}"]`)
}

function assetRequests() {
  return recordedRequests.filter(
    (url) => url.pathname === `/api/me/characters/${characterId}/assets`,
  )
}

function typeDetailRequests() {
  return recordedRequests.filter((url) => url.pathname.startsWith('/api/universe/types/'))
}

function hasHorizontalOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
}

function expectWithinViewport(
  box: { x: number; y: number; width: number; height: number } | null,
  width: number,
  height: number,
) {
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(width)
  expect(box!.y + box!.height).toBeLessThanOrEqual(height)
}

function isWithinViewport(
  box: { x: number; y: number; width: number; height: number } | null,
  width: number,
  height: number,
) {
  return Boolean(
    box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height,
  )
}

function assetsResponse() {
  return {
    characterId,
    assets: inventoryAssets(),
    enrichment:
      apiMode === 'partial'
        ? { types: 'complete', names: 'partial', locations: 'partial' }
        : { types: 'complete', names: 'complete', locations: 'complete' },
    cachedUntil: '2026-09-03T13:00:00.000Z',
    validatedAt: '2026-09-03T12:00:00.000Z',
    stale: false,
  }
}

function inventoryAssets() {
  const locationName = 'Jita IV - Moon 4'
  const assets = [
    asset(1, {
      customName: 'Cargo vault',
      typeName: 'Secure Container',
      locationName,
    }),
    asset(2, {
      customName: 'Deep scanner',
      locationId: 1,
      locationType: 'item',
      locationName: null,
      parentItemId: 1,
      locationFlag: 'Cargo',
    }),
    asset(3, {
      customName: apiMode === 'long' ? longValue : null,
      typeId: 103,
      typeName: apiMode === 'long' ? longValue : 'Inventory item 103',
      locationName: apiMode === 'long' ? longValue : locationName,
      locationFlag: apiMode === 'long' ? longValue : 'Hangar',
    }),
  ]
  for (let itemId = 4; itemId <= 237; itemId += 1) {
    assets.push(asset(itemId, { typeId: 100 + itemId, locationName }))
  }
  return assets
}

function asset(itemId: number, overrides: Record<string, unknown> = {}) {
  return {
    itemId,
    typeId: 100 + itemId,
    typeName: `Inventory item ${itemId}`,
    groupId: 12,
    groupName: 'Cargo Container',
    categoryId: 65,
    categoryName: 'Structure',
    unitVolume: 1.5,
    totalVolume: 1.5,
    quantity: itemId,
    isSingleton: true,
    isBlueprintCopy: null,
    customName: null,
    locationId: 60_003_760,
    locationType: 'station',
    locationName: 'Jita IV - Moon 4',
    locationFlag: 'Hangar',
    parentItemId: null,
    ...overrides,
  }
}

function ownedCharacter() {
  return {
    characterId,
    name: 'Manifest Pilot',
    corporationId: 98_000_001,
    allianceId: null,
    isMain: true,
    birthday: '2020-01-01T00:00:00.000Z',
    securityStatus: 1.2,
    raceFactionId: 500_001,
    location: { solarSystemId: 30_000_142, solarSystemName: 'Jita' },
    ship: { typeId: 670, typeName: 'Capsule', name: 'Manifest' },
    walletBalance: 1_000_000,
    totalSp: 5_000_000,
    corporation: { id: 98_000_001, name: 'Manifest Corporation' },
    alliance: null,
  }
}

function overviewResponse() {
  return {
    profile: {
      id: characterId,
      name: 'Manifest Pilot',
      birthday: '2020-01-01T00:00:00.000Z',
      gender: 'Female',
      race: 'Caldari',
      raceFactionId: null,
      bloodline: 'Deteis',
      securityStatus: 1.2,
      achievementScore: 0,
      factionId: null,
      bio: 'Inventory specialist.',
      corporation: {
        id: 98_000_001,
        name: 'Manifest Corporation',
        ticker: 'MNFS',
        memberCount: 8,
      },
      alliance: null,
    },
    location: { status: 'unavailable', message: 'Unavailable' },
    ship: { status: 'unavailable', message: 'Unavailable' },
    skills: { status: 'unavailable', message: 'Unavailable' },
  }
}
