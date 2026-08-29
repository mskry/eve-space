// @vitest-environment node

import { $fetch, createPage, setup, useTestContext } from '@nuxt/test-utils/e2e'
import type { Locator, Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startCorsJsonApi } from '../support/cors-json-api'

type ApiMode =
  | 'anonymous'
  | 'cspa-charge'
  | 'cspa-error'
  | 'detail-error'
  | 'mailbox'
  | 'mail-rejected'
  | 'label-delete-refused'
  | 'organize-scope-required'
  | 'roster-error'
  | 'search-scope-required'
  | 'send-delivery-unknown'
  | 'send-scope-required'
  | 'scope-required'
  | 'unknown-sender'
  | 'unowned'

interface RecordedRequest {
  readonly method: string
  readonly origin: string | null
  readonly body?: unknown
  readonly url: URL
}

interface HeldMutation {
  readonly mailId: number
  readonly method: 'DELETE' | 'PUT'
  readonly promise: Promise<void>
  readonly release: () => void
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
let heldMutation: HeldMutation | undefined

const apiServer = await startCorsJsonApi(async (request) => {
  const url = new URL(request.url ?? '/', 'http://mock-api.invalid')
  const requestBody =
    request.method === 'POST' || request.method === 'PUT'
      ? await readJsonRequest(request)
      : undefined
  recordedRequests.push({
    body: requestBody,
    method: request.method ?? 'GET',
    origin: request.headers.origin ?? null,
    url,
  })

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
        shellNavigationOrder: {
          dashboard: [],
          character: [
            { ownerId: 'core', navigationId: 'core-character-overview' },
            { ownerId: 'core', navigationId: 'core-character-skills' },
            { ownerId: 'core', navigationId: 'core-character-wallet' },
            { ownerId: 'core', navigationId: 'core-character-history' },
            { ownerId: 'core', navigationId: 'core-character-mail' },
          ],
        },
      },
    }
  }
  if (url.pathname === '/api/me/characters') {
    if (apiMode === 'roster-error') {
      return { status: 503, body: { code: 'ROSTER_UNAVAILABLE', message: 'Roster unavailable.' } }
    }
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
    if (
      url.pathname === `/api/me/characters/${characterId}/mail/recipients/resolve` &&
      request.method === 'POST'
    ) {
      const names =
        requestBody &&
        typeof requestBody === 'object' &&
        Array.isArray(Reflect.get(requestBody, 'names'))
          ? (Reflect.get(requestBody, 'names') as string[])
          : []
      return {
        body: {
          recipients: names.includes('Alliance Logistics')
            ? []
            : names.includes('Wingmate')
              ? [{ id: 44, type: 'character', name: 'Wingmate' }]
              : [{ id: 91, type: 'corporation', name: 'Operations Control' }],
        },
      }
    }
    if (
      url.pathname === `/api/me/characters/${characterId}/mail/recipients/search` &&
      request.method === 'GET'
    ) {
      if (apiMode === 'search-scope-required') {
        return {
          status: 403,
          body: {
            code: 'EVE_SCOPE_REQUIRED',
            message: 'Authorize recipient search for this character.',
            requiredScope: 'esi-search.search_structures.v1',
            authorizeUrl: `${apiOrigin}/auth/eve/reauthorize/${characterId}`,
          },
        }
      }
      return {
        body: {
          characterId,
          recipients: [{ id: 91, type: 'corporation', name: 'Operations Control' }],
          ...metadata,
        },
      }
    }
    if (
      url.pathname === `/api/me/characters/${characterId}/mail/cspa` &&
      request.method === 'POST'
    ) {
      if (apiMode === 'cspa-error') {
        return {
          status: 502,
          body: { code: 'ESI_UNAVAILABLE', message: 'Recipient charge unavailable.' },
        }
      }
      return { body: { characterId, cost: apiMode === 'cspa-charge' ? 125 : 0 } }
    }
    if (url.pathname === `/api/me/characters/${characterId}/mail` && request.method === 'POST') {
      if (apiMode === 'send-delivery-unknown') {
        return {
          status: 502,
          body: {
            code: 'MAIL_DELIVERY_UNKNOWN',
            message:
              'Mail delivery could not be confirmed. Inspect sent mail before sending again.',
          },
        }
      }
      if (apiMode === 'send-scope-required') {
        return {
          status: 403,
          body: {
            code: 'EVE_SCOPE_REQUIRED',
            message: 'Authorize sending mail for this character.',
            requiredScope: 'esi-mail.send_mail.v1',
            authorizeUrl: `${apiOrigin}/auth/eve/reauthorize/${characterId}`,
          },
        }
      }
      if (apiMode === 'mail-rejected') {
        return {
          status: 422,
          body: {
            code: 'MAIL_REJECTED',
            message: 'Recipient CSPA charge was not approved.',
          },
        }
      }
      return { status: 201, body: { characterId, mailId: 9001 } }
    }
    const detailMatch = url.pathname.match(/\/mail\/(\d+)$/)
    if (detailMatch && request.method === 'PUT') {
      await waitForHeldMutation('PUT', Number(detailMatch[1]))
      if (apiMode === 'organize-scope-required') {
        return {
          status: 403,
          body: {
            code: 'EVE_SCOPE_REQUIRED',
            message: 'Authorize mail organization for this character.',
            requiredScope: 'esi-mail.organize_mail.v1',
            authorizeUrl: `${apiOrigin}/auth/eve/reauthorize/${characterId}`,
          },
        }
      }
      return { status: 204, body: null }
    }
    if (detailMatch && request.method === 'DELETE') {
      await waitForHeldMutation('DELETE', Number(detailMatch[1]))
      if (apiMode === 'organize-scope-required') {
        return {
          status: 403,
          body: {
            code: 'EVE_SCOPE_REQUIRED',
            message: 'Authorize mail organization for this character.',
            requiredScope: 'esi-mail.organize_mail.v1',
            authorizeUrl: `${apiOrigin}/auth/eve/reauthorize/${characterId}`,
          },
        }
      }
      return { status: 204, body: null }
    }
    const labelMatch = url.pathname.match(/\/mail\/labels\/(\d+)$/)
    if (labelMatch && request.method === 'DELETE') {
      if (apiMode === 'label-delete-refused') {
        return {
          status: 409,
          body: { code: 'MAIL_MUTATION_REJECTED', message: 'EVE rejected the mail change.' },
        }
      }
      return { status: 204, body: null }
    }
    if (
      url.pathname === `/api/me/characters/${characterId}/mail/labels` &&
      request.method === 'POST'
    ) {
      return { status: 201, body: { characterId, labelId: 3 } }
    }
    if (
      url.pathname === `/api/me/characters/${characterId}/mail/labels` &&
      request.method === 'GET'
    ) {
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
    if (detailMatch) {
      const mailId = Number(detailMatch[1])
      if (apiMode === 'detail-error') {
        return {
          status: 502,
          body: { code: 'ESI_UNAVAILABLE', message: 'Mail detail is unavailable.' },
        }
      }
      return {
        body: {
          characterId,
          mailId,
          sender:
            apiMode === 'unknown-sender'
              ? { id: 91, type: 'unknown', name: null }
              : { id: 91, type: 'corporation', name: 'Operations Control' },
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
    if (url.pathname === `/api/me/characters/${characterId}/mail` && request.method === 'GET') {
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
    heldMutation?.release()
    heldMutation = undefined
    apiMode = 'mailbox'
    recordedRequests.length = 0
    apiServer.setAllowedOrigin(useTestContext().url)
  })

  afterEach(async () => {
    heldMutation?.release()
    heldMutation = undefined
    await Promise.all(Array.from(openPages, (page) => page.close()))
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

  it('processes a mounted reauthorization callback once without resetting mailbox state', async () => {
    const page = await openPage(`/characters/${characterId}/mail`)
    await page.locator('.mail-workspace').waitFor()
    const search = page.getByRole('searchbox', {
      name: 'Search loaded messages by subject or sender',
    })
    await search.fill('Priority')

    const sessionRequestsBefore = requestsFor('/auth/session').length
    const rosterRequestsBefore = requestsFor('/api/me/characters').length
    const mailRequestsBefore = mailRequests().length

    await page.evaluate(() => {
      history.pushState({}, '', `${location.pathname}?reauthorize=success`)
      dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
    })

    await page.getByText('Character authorization refreshed.', { exact: true }).waitFor()
    await expect.poll(() => new URL(page.url()).searchParams.has('reauthorize')).toBe(false)
    await expect
      .poll(() => requestsFor('/auth/session').length)
      .toBeGreaterThan(sessionRequestsBefore)
    await expect
      .poll(() => requestsFor('/api/me/characters').length)
      .toBeGreaterThan(rosterRequestsBefore)
    await expect.poll(() => mailRequests().length).toBeGreaterThan(mailRequestsBefore)
    expect(await search.inputValue()).toBe('Priority')

    const rosterRequestsAfterCallback = requestsFor('/api/me/characters').length
    const mailRequestsAfterCallback = mailRequests().length
    await page.goBack()
    await page.goForward()
    await page.waitForTimeout(100)

    expect(requestsFor('/api/me/characters')).toHaveLength(rosterRequestsAfterCallback)
    expect(mailRequests()).toHaveLength(mailRequestsAfterCallback)
    expect(await search.inputValue()).toBe('Priority')
  })

  it('cleans up callback state when an account-level refresh fails', async () => {
    const page = await openPage(`/characters/${characterId}/mail`)
    await page.locator('.mail-workspace').waitFor()
    const search = page.getByRole('searchbox', {
      name: 'Search loaded messages by subject or sender',
    })
    await search.fill('Priority')
    apiMode = 'roster-error'

    await page.evaluate(() => {
      history.pushState({}, '', `${location.pathname}?reauthorize=success`)
      dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
    })

    await page.getByText('Character authorization refreshed.', { exact: true }).waitFor()
    await expect.poll(() => new URL(page.url()).searchParams.has('reauthorize')).toBe(false)
    expect(await search.inputValue()).toBe('Priority')
  })

  it('processes direct-entry callback feedback before replacing the query', async () => {
    const page = await openPage(`/characters/${characterId}/mail?reauthorize=success`)
    await page.getByText('Character authorization refreshed.', { exact: true }).waitFor()
    await expect.poll(() => new URL(page.url()).searchParams.has('reauthorize')).toBe(false)

    await expect
      .poll(
        () =>
          mailRequests().filter(
            ({ method, url }) =>
              method === 'GET' && url.pathname === `/api/me/characters/${characterId}/mail`,
          ).length,
      )
      .toBe(1)
  })

  it('creates a label locally from the fixed palette without refetching labels', async () => {
    const page = await openPage(`/characters/${characterId}/mail`)
    await page.locator('.mail-workspace').waitFor()
    const labelsRequestsBefore = mailRequests().filter(
      ({ method, url }) =>
        method === 'GET' && url.pathname === `/api/me/characters/${characterId}/mail/labels`,
    ).length
    await page.getByRole('button', { name: 'MANAGE' }).click()
    const dialog = page.getByRole('dialog', { name: 'Manage mail labels' })
    await dialog.waitFor()

    const swatches = dialog.getByRole('radio')
    expect(await swatches.count()).toBe(18)
    for (const theme of ['void', 'high-sec']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value
      }, theme)
      const visibility = await swatches.evaluateAll((elements) =>
        elements.map((element) => {
          const swatch = element.querySelector<HTMLElement>('.mail-label-swatch')
          const style = getComputedStyle(element)
          return {
            borderStyle: style.borderStyle,
            borderWidth: style.borderWidth,
            color: swatch?.style.backgroundColor,
          }
        }),
      )
      expect(
        visibility.every(
          ({ borderStyle, borderWidth }) => borderStyle !== 'none' && borderWidth !== '0px',
        ),
      ).toBe(true)
      expect(new Set(visibility.map(({ color }) => color)).size).toBe(18)
    }

    await dialog.getByLabel('LABEL NAME').fill('Priority')
    await dialog.getByRole('radio', { name: 'Label color #fe0000' }).click()
    const createResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/me/characters/${characterId}/mail/labels`,
    )
    await dialog.getByRole('button', { name: 'CREATE LABEL' }).click()
    await createResponse
    await dialog.getByText('Priority', { exact: true }).waitFor()

    const createRequest = mailRequests().find(
      ({ method, url }) =>
        method === 'POST' && url.pathname === `/api/me/characters/${characterId}/mail/labels`,
    )
    expect(createRequest?.body).toEqual({ color: '#fe0000', name: 'Priority' })
    expect(
      mailRequests().filter(
        ({ method, url }) =>
          method === 'GET' && url.pathname === `/api/me/characters/${characterId}/mail/labels`,
      ),
    ).toHaveLength(labelsRequestsBefore)
  })

  it('withdraws deletion after EVE identifies a protected label', async () => {
    apiMode = 'label-delete-refused'
    const page = await openPage(`/characters/${characterId}/mail`)
    await page.locator('.mail-workspace').waitFor()
    await page.getByRole('button', { name: 'MANAGE' }).click()
    const dialog = page.getByRole('dialog', { name: 'Manage mail labels' })
    await dialog.getByRole('button', { name: 'Delete Archive' }).click()
    const confirmation = page.getByRole('alertdialog')
    await confirmation.waitFor()
    expect(await confirmation.textContent()).toContain('every message carrying it')
    await confirmation.getByRole('button', { name: 'Delete label' }).click()
    await page.getByText('Label cannot be deleted', { exact: true }).waitFor()
    await dialog.waitFor()

    expect(await dialog.getByText('Archive', { exact: true }).isVisible()).toBe(true)
    expect(await dialog.getByText('EVE PROTECTED', { exact: true }).isVisible()).toBe(true)
    expect(await dialog.getByRole('button', { name: 'Delete Archive' }).count()).toBe(0)
    await dialog.getByRole('button', { name: 'Close dialog' }).click()
    await expect.poll(() => dialog.count()).toBe(0)
    expect(await page.getByRole('button', { name: /^Archive/ }).isVisible()).toBe(true)
  })

  it('assigns the complete detail label set without carrying read state', async () => {
    const page = await openPage(`/characters/${characterId}/mail`)
    await page.locator('.mail-header-row').first().waitFor()
    await page.getByRole('button', { name: /Priority operations update/ }).click()
    await page.getByRole('heading', { name: 'Priority operations update' }).waitFor()
    await page.getByRole('button', { name: 'LABELS' }).click()
    const dialog = page.getByRole('dialog', { name: 'Assign mail labels' })
    const assignmentResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        new URL(response.url()).pathname.endsWith('/mail/120'),
    )
    await dialog.getByText('Archive', { exact: true }).click()
    await assignmentResponse

    const assignment = mailMutationRequests('PUT').find(
      ({ body }) => body && typeof body === 'object' && Object.hasOwn(body, 'labels'),
    )
    expect(assignment?.body).toEqual({ labels: [1, 2] })
    expect(assignment?.body).not.toHaveProperty('read')
    expect(await dialog.getByLabel('Archive').isChecked()).toBe(true)
    expect(await page.locator('.mail-reader').getByText('Inbox', { exact: true }).isVisible()).toBe(
      true,
    )
    expect(
      await page.locator('.mail-reader').getByText('Archive', { exact: true }).isVisible(),
    ).toBe(true)
  })

  it('seeds a reply from the open plain-text message', async () => {
    const page = await openPage(`/characters/${characterId}/mail`)
    await page.locator('.mail-header-row').first().waitFor()
    await page.getByRole('button', { name: /Priority operations update/ }).click()
    await page.getByRole('heading', { name: 'Priority operations update' }).waitFor()
    await page.getByRole('button', { name: 'REPLY', exact: true }).click()

    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    expect(await dialog.getByText('Operations Control', { exact: true }).isVisible()).toBe(true)
    expect(await dialog.getByLabel('Subject').inputValue()).toBe('Re: Priority operations update')
    expect(await dialog.getByLabel('Message').inputValue()).toContain(
      '--- Original message from Operations Control ---',
    )
    expect(await dialog.getByLabel('Message').inputValue()).toContain(hostileBody)
  })

  it('makes reply unavailable when the sender type is unresolved', async () => {
    apiMode = 'unknown-sender'
    const page = await openPage(`/characters/${characterId}/mail`)
    await page.locator('.mail-header-row').first().waitFor()
    await page.getByRole('button', { name: /Priority operations update/ }).click()
    await page.getByRole('heading', { name: 'Priority operations update' }).waitFor()

    const reply = page.getByRole('button', { name: 'REPLY', exact: true })
    expect(await reply.isDisabled()).toBe(true)
    expect(await reply.getAttribute('title')).toContain('sender type could not be resolved')
  })

  it('preserves an unconfirmed draft and never offers an immediate resend', async () => {
    apiMode = 'send-delivery-unknown'
    const page = await openPage(`/characters/${characterId}/mail`)
    await page.locator('.mail-header-row').first().waitFor()
    await page.getByRole('button', { name: /Priority operations update/ }).click()
    await page.getByRole('heading', { name: 'Priority operations update' }).waitFor()
    await page.getByRole('button', { name: 'REPLY', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()

    const sendResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/me/characters/${characterId}/mail`,
    )
    await dialog.getByRole('button', { name: 'SEND MAIL' }).click()
    await sendResponse
    await page.getByText('Mail delivery unconfirmed', { exact: true }).waitFor()

    expect(await dialog.getByLabel('Subject').inputValue()).toBe('Re: Priority operations update')
    expect(await dialog.getByRole('button', { name: 'SEND MAIL' }).isDisabled()).toBe(true)
    expect(mailSendRequests()).toHaveLength(1)
  })

  it('keeps reading and the draft available when sending needs authorization', async () => {
    apiMode = 'send-scope-required'
    const page = await openPage(`/characters/${characterId}/mail`)
    await page.locator('.mail-header-row').first().waitFor()
    await page.getByRole('button', { name: /Priority operations update/ }).click()
    await page.getByRole('heading', { name: 'Priority operations update' }).waitFor()
    await page.getByRole('button', { name: 'REPLY', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'SEND MAIL' }).click()

    await page.getByText('Mail sending authorization required', { exact: true }).waitFor()
    expect(
      await page
        .locator('.mail-reader')
        .getByText('Priority operations update', { exact: true })
        .count(),
    ).toBe(1)
    expect(await dialog.getByLabel('Subject').inputValue()).toBe('Re: Priority operations update')
    expect(await page.getByRole('link', { name: 'Authorize character' }).getAttribute('href')).toBe(
      `${apiOrigin}/auth/eve/reauthorize/${characterId}`,
    )
  })

  it('confirms before discarding content but closes an empty draft immediately', async () => {
    const page = await openPage(`/characters/${characterId}/mail`)
    await page.locator('.mail-workspace').waitFor()
    await page.getByRole('button', { name: 'COMPOSE', exact: true }).click()
    let dialog = page.getByRole('dialog')
    await dialog.waitFor()
    await dialog.getByRole('button', { name: 'CANCEL' }).click()
    await expect.poll(() => page.getByRole('dialog').count()).toBe(0)
    expect(await page.getByRole('alertdialog').count()).toBe(0)

    await page.getByRole('button', { name: 'COMPOSE', exact: true }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByLabel('Subject').fill('Unsaved draft')
    await dialog.getByRole('button', { name: 'CANCEL' }).click()
    const confirmation = page.getByRole('alertdialog')
    await confirmation.waitFor()
    expect(await dialog.isVisible()).toBe(false)
    await confirmation.getByRole('button', { name: 'Cancel' }).click()
    await dialog.waitFor()
    await dialog.getByRole('button', { name: 'CANCEL' }).click()
    await confirmation.waitFor()
    await confirmation.getByRole('button', { name: 'Discard draft' }).click()
    await expect.poll(() => page.getByRole('dialog').count()).toBe(0)
  })

  it('contains the compose form and actions within the dialog on desktop and mobile', async () => {
    const page = await openPage(`/characters/${characterId}/mail`)
    await page.setViewportSize({ width: 860, height: 740 })
    await page.locator('.mail-workspace').waitFor()
    const composeButton = page.getByRole('button', { name: 'COMPOSE', exact: true })
    const restingBackground = await composeButton.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    )
    expect(await composeButton.evaluate((element) => getComputedStyle(element).cursor)).toBe(
      'pointer',
    )
    await composeButton.hover()
    expect(
      await composeButton.evaluate((element) => getComputedStyle(element).backgroundColor),
    ).not.toBe(restingBackground)
    await composeButton.click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()

    expect(await measureComposeDialog(dialog)).toMatchObject({
      bodyOverflowY: 'auto',
      composeOverflows: false,
      dialogOverflows: false,
      fitsViewport: true,
      formFitsDialog: true,
    })

    await page.setViewportSize({ width: 390, height: 844 })
    await dialog.getByRole('button', { name: 'SEND MAIL' }).scrollIntoViewIfNeeded()
    expect(await measureComposeDialog(dialog)).toMatchObject({
      bodyOverflowY: 'auto',
      composeOverflows: false,
      dialogOverflows: false,
      fitsViewport: true,
      formFitsDialog: true,
    })
  })

  it('keeps local and exact addressing available when remote search needs authorization', async () => {
    apiMode = 'search-scope-required'
    const page = await openPage(`/characters/${characterId}/mail`)
    await page.locator('.mail-workspace').waitFor()
    await page.getByRole('button', { name: 'COMPOSE', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const recipientInput = dialog.getByRole('searchbox', { name: 'Recipients' })
    await recipientInput.fill('Operations')
    await expect
      .poll(
        () =>
          mailRequests().filter(({ url }) => url.pathname.endsWith('/mail/recipients/search'))
            .length,
      )
      .toBe(1)
    await expect
      .poll(() => dialog.textContent())
      .toContain('Authorize recipient search for this character.')
    expect(await dialog.getByRole('link', { name: 'Authorize search' }).isVisible()).toBe(true)

    await dialog.getByRole('button', { name: 'ADD EXACT NAME' }).click()
    await dialog.getByText('Operations Control', { exact: true }).waitFor()
    await recipientInput.fill('Alliance Logistics')
    await dialog.getByRole('button', { name: /Alliance Logistics/ }).click()
    expect(await dialog.getByText('Alliance Logistics', { exact: true }).isVisible()).toBe(true)
  })

  it('submits only character recipients to CSPA and requires approval for a charge', async () => {
    apiMode = 'cspa-charge'
    const page = await openPage(`/characters/${characterId}/mail`)
    await page.locator('.mail-workspace').waitFor()
    await page.getByRole('button', { name: 'COMPOSE', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('searchbox', { name: 'Recipients' }).fill('Wingmate')
    await dialog.getByRole('button', { name: 'ADD EXACT NAME' }).click()
    await dialog.getByText('Wingmate', { exact: true }).waitFor()
    await dialog.getByLabel('Subject').fill('Charged message')
    await dialog.getByLabel('Message').fill('Message body')
    await dialog.getByRole('button', { name: 'SEND MAIL' }).click()

    const confirmation = page.getByRole('alertdialog')
    await confirmation.waitFor()
    expect(await confirmation.textContent()).toContain('125 ISK')
    expect(mailSendRequests()).toHaveLength(0)
    const cspaRequest = mailRequests().find(({ url }) => url.pathname.endsWith('/mail/cspa'))
    expect(cspaRequest?.body).toEqual({ characterIds: [44] })
    await confirmation.getByRole('button', { name: 'Approve cost and send' }).click()
    await page.getByText('Mail sent', { exact: true }).waitFor()
    expect(mailSendRequests()[0]?.body).toMatchObject({ approvedCost: 125 })
  })

  it('allows an explicit zero-cost send after CSPA fails and offers charge recovery on refusal', async () => {
    apiMode = 'cspa-error'
    const page = await openPage(`/characters/${characterId}/mail`)
    await page.locator('.mail-workspace').waitFor()
    await page.getByRole('button', { name: 'COMPOSE', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('searchbox', { name: 'Recipients' }).fill('Wingmate')
    await dialog.getByRole('button', { name: 'ADD EXACT NAME' }).click()
    await dialog.getByText('Wingmate', { exact: true }).waitFor()
    await dialog.getByLabel('Subject').fill('Unknown charge')
    await dialog.getByLabel('Message').fill('Message body')
    await dialog.getByRole('button', { name: 'SEND MAIL' }).click()

    const unknownConfirmation = page.getByRole('alertdialog')
    await unknownConfirmation.waitFor()
    expect(await unknownConfirmation.textContent()).toContain('recipient charge is unknown')
    await unknownConfirmation.getByRole('button', { name: 'Send without approval' }).click()
    await page.getByText('Mail sent', { exact: true }).waitFor()
    expect(mailSendRequests()[0]?.body).toMatchObject({ approvedCost: 0 })

    apiMode = 'mail-rejected'
    await page.getByRole('button', { name: 'COMPOSE', exact: true }).click()
    const rejectedDialog = page.getByRole('dialog')
    await rejectedDialog.getByRole('searchbox', { name: 'Recipients' }).fill('Wingmate')
    await rejectedDialog.getByRole('button', { name: 'ADD EXACT NAME' }).click()
    await rejectedDialog.getByText('Wingmate', { exact: true }).waitFor()
    await rejectedDialog.getByLabel('Subject').fill('Rejected message')
    await rejectedDialog.getByLabel('Message').fill('Message body')
    await rejectedDialog.getByRole('button', { name: 'SEND MAIL' }).click()
    await rejectedDialog.getByText(/message was refused/i).waitFor()
    expect(
      await rejectedDialog.getByRole('button', { name: 'CHECK RECIPIENT CHARGE' }).isVisible(),
    ).toBe(true)
    const sendCountBeforeRecovery = mailSendRequests().length
    const chargeResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith('/mail/cspa'),
    )
    await rejectedDialog.getByRole('button', { name: 'CHECK RECIPIENT CHARGE' }).click()
    await chargeResponse
    await rejectedDialog.getByText(/No recipient charge applies/i).waitFor()
    expect(mailSendRequests()).toHaveLength(sendCountBeforeRecovery)
  })

  it('marks unread mail after dwelling and pins the open message under the unread filter', async () => {
    const page = await openPage(`/characters/${characterId}/mail`)
    await page.locator('.mail-header-row').first().waitFor()
    await page.locator('.mail-unread-toggle').click()

    const readResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        new URL(response.url()).pathname.endsWith('/mail/119'),
    )
    await page.getByText('Routine dispatch 1', { exact: true }).click()
    await readResponse

    expect(await page.getByText('Routine dispatch 1', { exact: true }).isVisible()).toBe(true)
    expect(await page.getByText('Message marked read', { exact: true }).count()).toBe(0)
    await page.getByText('Routine dispatch 3', { exact: true }).click()
    await expect.poll(() => page.getByText('Routine dispatch 1', { exact: true }).count()).toBe(0)
  })

  it('marks a read message unread once without automatically reopening it', async () => {
    const page = await openPage(`/characters/${characterId}/mail`)
    await page.locator('.mail-header-row').first().waitFor()
    await page.getByRole('button', { name: /Priority operations update/ }).click()
    await page.getByRole('heading', { name: 'Priority operations update' }).waitFor()
    await page.waitForFunction((deadline) => Date.now() >= deadline, Date.now() + 600)
    expect(
      mailMutationRequests('PUT').filter(({ url }) => url.pathname.endsWith('/mail/120')),
    ).toHaveLength(0)

    const unreadResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        new URL(response.url()).pathname.endsWith('/mail/120'),
    )
    await page.getByRole('button', { name: 'MARK UNREAD' }).click()
    await unreadResponse
    await page.waitForFunction((deadline) => Date.now() >= deadline, Date.now() + 700)

    expect(await page.getByRole('button', { name: 'MARK READ' }).isVisible()).toBe(true)
    expect(
      mailMutationRequests('PUT').filter(({ url }) => url.pathname.endsWith('/mail/120')),
    ).toHaveLength(1)
  })

  it('keeps reading available and offers reauthorization when organization is refused', async () => {
    apiMode = 'organize-scope-required'
    const page = await openPage(`/characters/${characterId}/mail`)
    await page.locator('.mail-header-row').first().waitFor()

    await page.getByText('Routine dispatch 1', { exact: true }).click()
    await page.getByText('Mail organization authorization required', { exact: true }).waitFor()

    expect(await page.getByRole('heading', { name: 'Mail 119' }).isVisible()).toBe(true)
    const recoveryLink = page.getByRole('link', { name: 'Authorize character' })
    expect(await recoveryLink.getAttribute('href')).toBe(
      `${apiOrigin}/auth/eve/reauthorize/${characterId}`,
    )
    await page.waitForFunction((deadline) => Date.now() >= deadline, Date.now() + 5_200)
    expect(await recoveryLink.isVisible()).toBe(true)
  })

  it('does not mark a message read when its detail cannot be opened', async () => {
    apiMode = 'detail-error'
    const page = await openPage(`/characters/${characterId}/mail`)
    await page.locator('.mail-header-row').first().waitFor()

    await page.getByText('Routine dispatch 1', { exact: true }).click()
    await page.getByRole('heading', { name: 'Contents could not be retrieved' }).waitFor()
    await page.waitForFunction((deadline) => Date.now() >= deadline, Date.now() + 700)

    expect(mailMutationRequests('PUT')).toHaveLength(0)
  })

  it('waits for an in-flight read before allowing confirmed deletion', async () => {
    holdMutation('PUT', 119)
    const page = await openPage(`/characters/${characterId}/mail`)
    await page.locator('.mail-header-row').first().waitFor()
    await page.getByText('Routine dispatch 1', { exact: true }).click()
    await page.getByRole('heading', { name: 'Mail 119' }).waitFor()
    await page.getByRole('button', { name: 'DELETE' }).click()
    const dialog = page.getByRole('alertdialog')
    await dialog.waitFor()

    await expect.poll(() => mailMutationRequests('PUT').length).toBe(1)
    const confirm = dialog.locator('.ui-confirm-dialog-action')
    expect(await confirm.isDisabled()).toBe(true)
    expect(mailMutationRequests('DELETE')).toHaveLength(0)

    heldMutation?.release()
    heldMutation = undefined
    await expect.poll(() => confirm.isEnabled()).toBe(true)
    const allMailUnreadCount = page
      .locator('.mail-nav-row')
      .filter({ hasText: 'All mail' })
      .locator('strong')
    const inboxUnreadCount = page
      .locator('.mail-nav-row')
      .filter({ hasText: 'Inbox' })
      .locator('strong')
    await expect
      .poll(async () => [
        await allMailUnreadCount.textContent(),
        await inboxUnreadCount.textContent(),
      ])
      .toEqual(['3', '3'])
    const deleteResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        new URL(response.url()).pathname.endsWith('/mail/119'),
    )
    await confirm.click()
    await deleteResponse
    expect(mailMutationRequests('DELETE')).toHaveLength(1)
    await expect
      .poll(async () => [
        await allMailUnreadCount.textContent(),
        await inboxUnreadCount.textContent(),
      ])
      .toEqual(['3', '3'])
  })

  it('keeps the workspace during deletion and retains deletion across client navigation', async () => {
    holdMutation('DELETE', 120)
    const page = await openPage(`/characters/${characterId}/mail`)
    await page.locator('.mail-header-row').first().waitFor()
    await page.getByRole('button', { name: /Priority operations update/ }).click()
    await page.getByRole('heading', { name: 'Priority operations update' }).waitFor()
    await page.getByRole('button', { name: 'DELETE' }).click()

    const dialog = page.getByRole('alertdialog')
    await dialog.waitFor()
    expect(await dialog.textContent()).toContain('no archive or trash')
    expect(mailMutationRequests('DELETE')).toHaveLength(0)

    const deleteResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        new URL(response.url()).pathname.endsWith('/mail/120'),
    )
    await dialog.getByRole('button', { name: 'Delete message' }).click()
    await expect.poll(() => mailMutationRequests('DELETE').length).toBe(1)
    expect(await page.locator('.mail-workspace').isVisible()).toBe(true)
    await page.locator('#mail-reader-empty-title').waitFor()
    heldMutation?.release()
    heldMutation = undefined
    await deleteResponse

    expect(await page.getByText('Priority operations update', { exact: true }).count()).toBe(0)

    const headerRequests = mailRequests().filter(
      ({ method, url }) =>
        method === 'GET' && url.pathname === `/api/me/characters/${characterId}/mail`,
    ).length
    await page.getByRole('link', { name: 'OVERVIEW', exact: true }).click()
    await page.getByRole('link', { name: 'MAIL', exact: true }).click()
    await page.locator('.mail-workspace').waitFor()
    expect(await page.getByText('Priority operations update', { exact: true }).count()).toBe(0)
    expect(
      mailRequests().filter(
        ({ method, url }) =>
          method === 'GET' && url.pathname === `/api/me/characters/${characterId}/mail`,
      ),
    ).toHaveLength(headerRequests)
  })

  it('stacks mailbox panes without horizontal overflow on mobile', async () => {
    const page = await openPage(`/characters/${characterId}/mail`)
    const workspace = page.locator('.mail-workspace')
    await workspace.waitFor()
    const recordNavigation = page.getByRole('navigation', { name: 'Character record sections' })
    const desktopMetrics = await recordNavigation.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }))
    expect(desktopMetrics.scrollWidth).toBeLessThanOrEqual(desktopMetrics.clientWidth)

    await page.setViewportSize({ width: 390, height: 844 })

    const layout = await workspace.evaluate((element) => getComputedStyle(element).display)
    const sidebarBox = await page.locator('.mail-sidebar').boundingBox()
    const headersBox = await page.locator('.mail-header-list').boundingBox()
    const readerBox = await page.locator('.mail-reader').boundingBox()
    const navigationMetrics = await recordNavigation.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }))
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    const mailNavigationLink = recordNavigation.getByRole('link', { name: 'MAIL', exact: true })
    await mailNavigationLink.focus()
    const focusOutline = await mailNavigationLink.evaluate(
      (element) => getComputedStyle(element).outlineWidth,
    )

    expect(layout).toBe('block')
    expect(sidebarBox).not.toBeNull()
    expect(headersBox).not.toBeNull()
    expect(readerBox).not.toBeNull()
    expect(headersBox!.y).toBeGreaterThan(sidebarBox!.y)
    expect(readerBox!.y).toBeGreaterThan(headersBox!.y)
    expect(await recordNavigation.getByRole('link').count()).toBe(5)
    expect(navigationMetrics.scrollWidth).toBeGreaterThan(navigationMetrics.clientWidth)
    expect(focusOutline).not.toBe('0px')
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

async function measureComposeDialog(dialog: Locator) {
  return dialog.evaluate((element) => {
    const body = element.querySelector<HTMLElement>('.ui-dialog-body')
    const compose = element.querySelector<HTMLElement>('.mail-compose')
    if (!body || !compose) throw new Error('Compose dialog layout was not rendered.')
    const dialogRect = element.getBoundingClientRect()
    const composeRect = compose.getBoundingClientRect()
    const tolerance = 1

    return {
      bodyOverflowY: getComputedStyle(body).overflowY,
      composeOverflows: compose.scrollWidth > compose.clientWidth,
      dialogOverflows: element.scrollWidth > element.clientWidth,
      fitsViewport:
        dialogRect.left >= -tolerance &&
        dialogRect.top >= -tolerance &&
        dialogRect.right <= window.innerWidth + tolerance &&
        dialogRect.bottom <= window.innerHeight + tolerance,
      formFitsDialog:
        composeRect.left >= dialogRect.left - tolerance &&
        composeRect.right <= dialogRect.right + tolerance,
    }
  })
}

function mailRequests() {
  return recordedRequests.filter(({ url }) =>
    url.pathname.startsWith(`/api/me/characters/${characterId}/mail`),
  )
}

function requestsFor(path: string) {
  return recordedRequests.filter(({ url }) => url.pathname === path)
}

function mailMutationRequests(method: 'DELETE' | 'PUT') {
  return mailRequests().filter((request) => request.method === method)
}

function mailSendRequests() {
  return mailRequests().filter(
    ({ method, url }) =>
      method === 'POST' && url.pathname === `/api/me/characters/${characterId}/mail`,
  )
}

function holdMutation(method: HeldMutation['method'], mailId: number) {
  let release!: () => void
  const promise = new Promise<void>((resolve) => (release = resolve))
  heldMutation = { mailId, method, promise, release }
}

async function waitForHeldMutation(method: HeldMutation['method'], mailId: number) {
  if (heldMutation?.method === method && heldMutation.mailId === mailId) {
    await heldMutation.promise
  }
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

async function readJsonRequest(request: import('node:http').IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  if (chunks.length === 0) return undefined
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}
