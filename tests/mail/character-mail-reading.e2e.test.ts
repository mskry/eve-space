// @vitest-environment node

import { $fetch, createPage, setup, useTestContext } from '@nuxt/test-utils/e2e'
import type { Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startCorsJsonApi } from '../support/cors-json-api'

type ApiMode = 'anonymous' | 'mailbox' | 'scope-required' | 'unowned'

interface RecordedRequest {
  readonly origin: string | null
  readonly url: URL
}

const characterId = 7
const metadata = {
  cachedUntil: '2026-08-28T12:00:30.000Z',
  source: 'esi',
  stale: false,
  quota: {},
}
const hostileBody =
  '<img src=x onerror="window.__mailBodyExecuted=true">This remains text.\n\n<script>window.__mailBodyExecuted=true</script>'
const initialMessages = Array.from({ length: 18 }, (_, index) =>
  mailHeader(120 - index, index === 0 ? 'Priority operations update' : `Routine dispatch ${index}`),
)
const archivedMessage = mailHeader(80, 'Archived dispatch', [2])
const olderMessage = mailHeader(79, 'Older logistics report')
const recordedRequests: RecordedRequest[] = []
let apiMode: ApiMode = 'mailbox'
let apiOrigin = ''

const apiServer = await startCorsJsonApi((request) => {
  const url = new URL(request.url ?? '/', 'http://mock-api.invalid')
  recordedRequests.push({ origin: request.headers.origin ?? null, url })

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
    if (apiMode === 'anonymous') return { body: { authenticated: false } }
    return {
      body: {
        authenticated: true,
        account: {
          userId: 'mail-e2e-user',
          mainCharacter: { characterId, name: 'Reading Pilot' },
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
  if (url.pathname === '/api/me/characters') {
    return { body: { characters: apiMode === 'unowned' ? [] : [ownedCharacter()] } }
  }
  if (url.pathname.startsWith(`/api/me/characters/${characterId}/mail`)) {
    if (apiMode === 'scope-required') {
      return {
        status: 403,
        body: {
          code: 'EVE_SCOPE_REQUIRED',
          message: 'Authorize mail access for this character.',
          requiredScope: 'esi-mail.read_mail.v1',
          authorizeUrl: `${apiOrigin}/auth/eve/reauthorize/${characterId}`,
        },
      }
    }
    if (url.pathname === `/api/me/characters/${characterId}/mail/labels`) {
      return {
        body: {
          characterId,
          labels: [
            { labelId: 1, name: 'Inbox', color: '#ffffff', unreadCount: 4 },
            { labelId: 2, name: 'Archive', color: '#999999', unreadCount: 0 },
          ],
          totalUnreadCount: 4,
          ...metadata,
        },
      }
    }
    if (url.pathname === `/api/me/characters/${characterId}/mail/lists`) {
      return {
        body: {
          characterId,
          mailingLists: [{ mailingListId: 77, name: 'Alliance Logistics' }],
          ...metadata,
        },
      }
    }
    const detailMatch = url.pathname.match(/\/mail\/(\d+)$/)
    if (detailMatch) {
      const mailId = Number(detailMatch[1])
      return {
        body: {
          characterId,
          mailId,
          sender: { id: 91, type: 'corporation', name: 'Operations Control' },
          recipients: [{ id: characterId, type: 'character', name: 'Reading Pilot' }],
          subject: mailId === 120 ? 'Priority operations update' : `Mail ${mailId}`,
          sentAt: '2026-08-28T11:55:00.000Z',
          labelIds: [1],
          isRead: false,
          body: hostileBody,
          ...metadata,
        },
      }
    }
    if (url.pathname === `/api/me/characters/${characterId}/mail`) {
      const labels = url.searchParams.getAll('labels')
      const lastMailId = url.searchParams.get('lastMailId')
      return {
        body: {
          characterId,
          messages: labels.includes('2')
            ? [archivedMessage]
            : lastMailId === '100'
              ? [olderMessage]
              : initialMessages,
          nextLastMailId: labels.includes('2') || lastMailId === '100' ? null : 100,
          ...metadata,
        },
      }
    }
  }

  return { status: 404, body: { code: 'NOT_FOUND', message: 'Not found.' } }
})
apiOrigin = apiServer.origin
process.env.NUXT_PUBLIC_API_BASE = apiOrigin
process.env.NUXT_PUBLIC_EVE_IMAGE_BASE = apiOrigin

afterAll(apiServer.close)

describe('character mail reading', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    build: false,
    nuxtConfig: {
      nitro: {
        output: {
          dir: fileURLToPath(new URL('../../.output', import.meta.url)),
        },
      },
    },
    browser: true,
    server: true,
    captureServerLogs: false,
    setupTimeout: 120_000,
  })

  const openPages = new Set<Page>()

  beforeEach(() => {
    apiMode = 'mailbox'
    recordedRequests.length = 0
    apiServer.setAllowedOrigin(useTestContext().url)
  })

  afterEach(async () => {
    await Promise.all([...openPages].map((page) => page.close()))
    openPages.clear()
  })

  it('gates anonymous and unowned access without requesting mail during SSR', async () => {
    const html = await $fetch(`/characters/${characterId}/mail`)

    expect(html).toContain('Verifying account identity...')
    expect(mailRequests()).toHaveLength(0)

    apiMode = 'anonymous'
    recordedRequests.length = 0
    const anonymousPage = await openPage(`/characters/${characterId}/mail`)
    await anonymousPage.waitForURL((url) => url.pathname === '/auth')

    expect(new URL(anonymousPage.url()).searchParams.get('redirect')).toBe(
      `/characters/${characterId}/mail`,
    )
    expect(mailRequests()).toHaveLength(0)
    await closePage(anonymousPage)

    apiMode = 'unowned'
    recordedRequests.length = 0
    const unownedPage = await openPage(`/characters/${characterId}/mail`)
    await unownedPage.getByRole('heading', { name: 'Character not found' }).waitFor()

    expect(mailRequests()).toHaveLength(0)
  })

  it('renders and reads paginated mail in the bounded desktop workspace', async () => {
    const page = await openPage(`/characters/${characterId}/mail`)
    await page.setViewportSize({ width: 1440, height: 900 })
    const workspace = page.locator('.mail-workspace')
    await workspace.waitFor()
    await page.locator('.mail-header-row').first().waitFor()

    const desktopLayout = await workspace.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        display: style.display,
        height: element.getBoundingClientRect().height,
        columns: style.gridTemplateColumns.split(' ').length,
      }
    })
    const headerScroll = await page
      .locator('.mail-header-scroll .ui-scroll-area-viewport')
      .evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }))

    expect(desktopLayout).toMatchObject({ display: 'grid', columns: 3 })
    expect(desktopLayout.height).toBeLessThan(900)
    expect(headerScroll.scrollHeight).toBeGreaterThan(headerScroll.clientHeight)
    expect(await page.locator('.mail-header-row').count()).toBe(18)

    const detailResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/mail/120'),
    )
    await page.getByRole('button', { name: /Priority operations update/ }).click()
    await detailResponse
    await page.getByRole('heading', { name: 'Priority operations update' }).waitFor()

    const body = page.locator('.mail-body-text')
    expect(await body.textContent()).toContain(
      '<img src=x onerror="window.__mailBodyExecuted=true">',
    )
    expect(await body.locator('img, script').count()).toBe(0)
    expect(await page.evaluate(() => Reflect.get(window, '__mailBodyExecuted'))).toBeUndefined()

    const filteredResponse = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.pathname.endsWith(`/${characterId}/mail`) && url.searchParams.get('labels') === '2'
    })
    await page.getByRole('button', { name: /^Archive/ }).click()
    await filteredResponse
    await page.getByText('Archived dispatch', { exact: true }).waitFor()

    const filteredRequest = mailRequests().find(({ url }) => url.searchParams.get('labels') === '2')
    expect(filteredRequest?.origin).toBe(new URL(useTestContext().url).origin)

    await page.getByRole('button', { name: /^All mail/ }).click()
    await page.getByText('Priority operations update', { exact: true }).waitFor()

    const olderResponse = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return (
        url.pathname.endsWith(`/${characterId}/mail`) &&
        url.searchParams.get('lastMailId') === '100'
      )
    })
    await page.getByRole('button', { name: 'LOAD OLDER MESSAGES' }).click()
    await olderResponse
    await page.getByText('Older logistics report', { exact: true }).waitFor()
    expect(await page.getByText('19 messages loaded', { exact: true }).isVisible()).toBe(true)
  })

  it('offers character reauthorization when the mail scope is missing', async () => {
    apiMode = 'scope-required'
    const page = await openPage(`/characters/${characterId}/mail`)
    await page.getByRole('heading', { name: 'Mail authorization required' }).waitFor()

    const recoveryLink = page.getByRole('link', { name: 'AUTHORIZE THIS CHARACTER' })
    expect(await recoveryLink.getAttribute('href')).toBe(
      `${apiOrigin}/auth/eve/reauthorize/${characterId}`,
    )
    expect(mailRequests().length).toBeGreaterThan(0)
  })

  it('stacks mailbox panes without horizontal overflow on mobile', async () => {
    const page = await openPage(`/characters/${characterId}/mail`)
    await page.setViewportSize({ width: 390, height: 844 })
    const workspace = page.locator('.mail-workspace')
    await workspace.waitFor()

    const layout = await workspace.evaluate((element) => getComputedStyle(element).display)
    const sidebarBox = await page.locator('.mail-sidebar').boundingBox()
    const headersBox = await page.locator('.mail-header-list').boundingBox()
    const readerBox = await page.locator('.mail-reader').boundingBox()
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )

    expect(layout).toBe('block')
    expect(sidebarBox).not.toBeNull()
    expect(headersBox).not.toBeNull()
    expect(readerBox).not.toBeNull()
    expect(headersBox!.y).toBeGreaterThan(sidebarBox!.y)
    expect(readerBox!.y).toBeGreaterThan(headersBox!.y)
    expect(Math.abs(headersBox!.x - sidebarBox!.x)).toBeLessThan(2)
    expect(Math.abs(readerBox!.x - sidebarBox!.x)).toBeLessThan(2)
    expect(hasHorizontalOverflow).toBe(false)
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

function mailRequests() {
  return recordedRequests.filter(({ url }) =>
    url.pathname.startsWith(`/api/me/characters/${characterId}/mail`),
  )
}

function mailHeader(mailId: number, subject: string, labelIds = [1]) {
  return {
    mailId,
    sender: { id: 91, type: 'corporation', name: 'Operations Control' },
    recipients: [{ id: characterId, type: 'character', name: 'Reading Pilot' }],
    subject,
    sentAt: '2026-08-28T11:55:00.000Z',
    labelIds,
    isRead: mailId % 2 === 0,
  }
}

function ownedCharacter() {
  return {
    characterId,
    name: 'Reading Pilot',
    corporationId: 98_000_001,
    allianceId: null,
    isMain: true,
    birthday: '2020-01-01T00:00:00.000Z',
    securityStatus: 1.2,
    raceFactionId: 500_001,
    location: { solarSystemId: 30_000_142, solarSystemName: 'Jita' },
    ship: { typeId: 670, typeName: 'Capsule', name: 'Reader One' },
    walletBalance: 1_000_000,
    totalSp: 5_000_000,
    corporation: { id: 98_000_001, name: 'Reading Corporation' },
    alliance: null,
  }
}
