// @vitest-environment node

import { createPage, setup, useTestContext } from '@nuxt/test-utils/e2e'
import type { Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startCorsJsonApi } from '../support/cors-json-api'

type HistoryMode = 'data' | 'empty' | 'error'

const corporationId = 98_000_001
const recordedPaths: string[] = []
let apiOrigin = ''
let historyMode: HistoryMode = 'data'

const apiServer = await startCorsJsonApi((request) => {
  const url = new URL(request.url ?? '/', 'http://mock-api.invalid')
  recordedPaths.push(url.pathname)

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
          userId: 'corporation-e2e-user',
          mainCharacter: { characterId: 7, name: 'Corporation Pilot' },
        },
      },
    }
  }
  if (url.pathname === '/api/admin/session') return { body: { authenticated: false } }
  if (url.pathname === '/api/modules') {
    return {
      body: {
        enabledModuleIds: [],
        shellNavigationOrder: { dashboard: [], character: [] },
      },
    }
  }
  if (url.pathname === `/api/corporations/${corporationId}`) {
    return {
      body: {
        corporation: {
          corporationId,
          name: 'Navigation Industries',
          ticker: 'NAV',
          memberCount: 42,
          ceoId: 9,
          ceoName: 'Chief Navigator',
          creatorId: 10,
          creatorName: 'First Navigator',
          taxRate: 5,
          dateFounded: '2020-01-01T00:00:00Z',
          description: 'A corporation used to verify routed records.',
          url: null,
          factionId: null,
          homeStationId: null,
          homeStationName: null,
          shares: null,
          allianceId: 99_000_001,
          allianceName: 'Route Alliance',
          type: 'player_owned',
          state: 'active',
          warEligible: true,
          warHistory: [],
        },
      },
    }
  }
  if (url.pathname === `/api/corporations/${corporationId}/alliance-history`) {
    if (historyMode === 'error') {
      return {
        status: 502,
        body: { message: 'Alliance history is temporarily unavailable.' },
      }
    }
    return {
      body: {
        corporationId,
        history:
          historyMode === 'empty'
            ? []
            : [
                {
                  allianceId: 99_000_001,
                  allianceName: 'Route Alliance',
                  isDeleted: false,
                  recordId: 1,
                  startDate: '2024-01-01T00:00:00Z',
                },
              ],
      },
    }
  }

  return { status: 404, body: { code: 'NOT_FOUND', message: 'Not found.' } }
})

apiOrigin = apiServer.origin
process.env.NUXT_PUBLIC_API_BASE = apiOrigin
process.env.NUXT_PUBLIC_EVE_IMAGE_BASE = apiOrigin

afterAll(apiServer.close)

describe('corporation record routes', async () => {
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
    historyMode = 'data'
    recordedPaths.length = 0
    apiServer.setAllowedOrigin(useTestContext().url)
  })

  afterEach(async () => {
    await Promise.all(Array.from(openPages, (page) => page.close()))
    openPages.clear()
  })

  it('loads overview without alliance history and keeps the shell mounted through navigation', async () => {
    const page = await openPage(`/corporation/${corporationId}`)
    await page.getByRole('heading', { name: 'Navigation Industries' }).waitFor()
    await page.getByText('A corporation used to verify routed records.').waitFor()

    expect(historyRequests()).toHaveLength(0)
    const shellHeader = await page.locator('.character-shell-header').elementHandle()
    if (!shellHeader) throw new Error('Corporation shell header was not rendered.')

    await page.getByRole('link', { name: 'ALLIANCE HISTORY' }).click()
    await page.waitForURL(
      (url) => url.pathname === `/corporation/${corporationId}/alliance-history`,
    )
    await page.getByText('Route Alliance', { exact: true }).waitFor()

    expect(await shellHeader.evaluate((element) => element.isConnected)).toBe(true)
    expect(historyRequests()).toHaveLength(1)
    expect(
      await page.getByRole('link', { name: 'ALLIANCE HISTORY' }).getAttribute('aria-current'),
    ).toBe('page')

    await page.goBack()
    await page.waitForURL((url) => url.pathname === `/corporation/${corporationId}`)
    await expect
      .poll(() => page.getByRole('link', { name: 'OVERVIEW' }).getAttribute('aria-current'))
      .toBe('page')

    await page.goForward()
    await page.waitForURL(
      (url) => url.pathname === `/corporation/${corporationId}/alliance-history`,
    )
    await expect
      .poll(() => page.getByRole('link', { name: 'ALLIANCE HISTORY' }).getAttribute('aria-current'))
      .toBe('page')
  })

  it('supports direct history entry and keeps navigation stable for empty and failed data', async () => {
    historyMode = 'empty'
    const emptyPage = await openPage(`/corporation/${corporationId}/alliance-history`)
    await emptyPage.setViewportSize({ width: 390, height: 844 })
    await emptyPage.getByRole('heading', { name: 'No alliance history' }).waitFor()
    const navigation = emptyPage.getByRole('navigation', { name: 'Corporation record sections' })
    expect(await navigation.getByRole('link').count()).toBe(2)
    await navigation.getByRole('link', { name: 'OVERVIEW' }).focus()
    expect(
      await navigation
        .getByRole('link', { name: 'OVERVIEW' })
        .evaluate((element) => getComputedStyle(element).outlineWidth),
    ).not.toBe('0px')
    expect(
      await emptyPage.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false)
    await closePage(emptyPage)

    historyMode = 'error'
    recordedPaths.length = 0
    const errorPage = await openPage(`/corporation/${corporationId}/alliance-history`)
    await errorPage.getByRole('heading', { name: 'Alliance history unavailable' }).waitFor()
    expect(
      await errorPage
        .getByRole('navigation', { name: 'Corporation record sections' })
        .getByRole('link')
        .count(),
    ).toBe(2)

    const requestsBeforeRetry = historyRequests().length
    await errorPage.getByRole('button', { name: 'RETRY UPLINK' }).click()
    await expect.poll(() => historyRequests().length).toBeGreaterThan(requestsBeforeRetry)
  })

  it('rejects malformed IDs without requesting a normalized corporation', async () => {
    const page = await openPage('/corporation/1e3')
    await page.getByRole('heading', { name: 'Corporation not found' }).waitFor()

    expect(recordedPaths.some((path) => path.startsWith('/api/corporations/'))).toBe(false)
  })

  async function openPage(path: string) {
    const page = await createPage(path)
    openPages.add(page)
    return page
  }

  async function closePage(page: Page) {
    openPages.delete(page)
    await page.close()
  }
})

function historyRequests() {
  return recordedPaths.filter(
    (path) => path === `/api/corporations/${corporationId}/alliance-history`,
  )
}
