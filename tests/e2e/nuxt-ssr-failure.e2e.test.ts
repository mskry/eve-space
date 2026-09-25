// @vitest-environment node

import { $fetch, createPage, setup, useTestContext } from '@nuxt/test-utils/e2e'
import { expect as expectPage, type BrowserContext, type Page } from '@playwright/test'
import type { IncomingMessage } from 'node:http'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startCorsJsonApi } from '../support/cors-json-api'

const DATABASE_NAME = 'eve-space-query-cache'
const DATABASE_VERSION = 1
const OBJECT_STORE_NAME = 'query-cache'
const PERSISTED_CACHE_KEY = 'eve-space-esi-query-cache'
const INVALIDATION_CONTROL_KEY = 'eve-space-esi-query-cache-control'
const PUBLIC_QUERY_KEY = ['public', 'e2e', 'query-persistence'] as const
const PRIVATE_QUERY_KEY = ['private', 'characters', 7, 'overview-v2'] as const
const PUBLIC_FIXTURE_PATH = '/__e2e/query-persistence'
const CHARACTER_CHILD_REQUESTS = [
  { resources: ['skills', 'attributes', 'skill-queue'], section: 'skills' },
  { resources: ['history'], section: 'history' },
  { resources: ['clones', 'implants', 'skills'], section: 'clones' },
  { resources: ['mail', 'mail/labels', 'mail/lists'], section: 'mail' },
  { resources: ['assets'], section: 'assets' },
  { resources: ['wallet', 'wallet/journal'], section: 'finance' },
] as const

let apiAvailable = false
let characterDataAvailable = true
let rosterDataAvailable = true
let currentUserId: string | null = 'test-user'
let publicDataAvailable = true
let publicFixtureText = 'Current public ESI data.'
let publicRequestCount = 0
let publicBrowserRequestCount = 0
let overviewRequestCount = 0
let admissionRequestCount = 0
let bootstrapAdmissionEnabled = false
let bootstrapAdmissionUnavailable = false
let sessionRequestCount = 0
let overviewText = 'Cached capsuleer record.'
let admissionGate: Deferred | undefined
let overviewGate: Deferred | undefined
let rosterGate: Deferred | undefined
let overviewDeferredUserId: string | undefined
let rosterCharacters: ReturnType<typeof ownedCharacter>[] = []
const childRequestPaths: string[] = []
const rosterResponseStatuses: number[] = []
const managedPages = new Set<Page>()
const managedContexts = new Set<BrowserContext>()

const apiServer = await startCorsJsonApi(handleApiRequest)
process.env.NUXT_PUBLIC_API_BASE = apiServer.origin

afterAll(apiServer.close)
beforeEach(resetFixtureState)
afterEach(async () => {
  admissionGate?.resolve()
  overviewGate?.resolve()
  rosterGate?.resolve()
  await Promise.all([...managedPages].map((page) => page.close()))
  managedPages.clear()
  await Promise.all([...managedContexts].map((context) => context.close()))
  managedContexts.clear()
})

describe('Nuxt anonymous SSR boundary', async () => {
  await setup({
    browser: true,
    build: false,
    captureServerLogs: false,
    nuxtConfig: {
      nitro: {
        output: {
          dir: fileURLToPath(new URL('../../.output-e2e', import.meta.url)),
        },
      },
    },
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    server: true,
    setupTimeout: 120_000,
  })

  it('renders a neutral session state without requiring the API during SSR', async () => {
    const html = await $fetch('/characters')

    expect(html).toContain('Verifying account identity...')
    expect(html).toContain('All characters')
    expect(html).toContain('data-ssr="true"')
    expect(html).not.toContain('ApiQueryError')
  })

  it('renders the public overview while account verification is pending', async () => {
    const html = await $fetch('/')

    expect(html).toContain('Verifying account identity...')
    expect(html).toContain('Command overview')
    expect(html).toContain('Identity link available')
    expect(html).toContain('Public records are available now.')
  })

  it('keeps the character route available when the API is down', async () => {
    apiAvailable = false
    apiServer.setAllowedOrigin(applicationOrigin())
    const page = await createPage('/characters')

    await page.getByRole('heading', { name: 'Session unavailable' }).waitFor()

    expect(new URL(page.url()).pathname).toBe('/characters')
    expect(await page.getByRole('heading', { name: 'All characters' }).isVisible()).toBe(true)
    expect(await page.locator('#main-content').count()).toBe(1)
  })

  it('loads a cold protected overview with bootstrap admission and no separate admission request', async () => {
    configureAuthenticatedApi()
    bootstrapAdmissionEnabled = true
    const page = trackPage(await createPage('/characters/7'))

    await page.getByText(overviewText, { exact: true }).waitFor()

    expect(overviewRequestCount).toBeGreaterThan(0)
    expect(admissionRequestCount).toBe(0)
    expect(sessionRequestCount).toBe(1)
  })

  it('loads the overview before roster enrichment completes', async () => {
    configureAuthenticatedApi()
    bootstrapAdmissionEnabled = true
    rosterGate = deferred()
    const page = trackPage(await createPage('/characters/7'))

    await page.getByText(overviewText, { exact: true }).waitFor()

    expect(overviewRequestCount).toBe(1)
    expect(admissionRequestCount).toBe(0)
    rosterGate.resolve()
    await page.getByRole('heading', { name: 'Persistent Pilot' }).waitFor()
    expect(overviewRequestCount).toBe(1)
  })

  it('falls back to the roster when bootstrap admission is unavailable', async () => {
    configureAuthenticatedApi()
    bootstrapAdmissionEnabled = true
    bootstrapAdmissionUnavailable = true
    rosterGate = deferred()
    const page = trackPage(await createPage('/characters/7'))

    await page.getByText('Resolving character authorization...', { exact: true }).waitFor()
    expect(overviewRequestCount).toBe(0)
    rosterGate.resolve()
    await page.getByText(overviewText, { exact: true }).waitFor()
    expect(overviewRequestCount).toBe(1)
  })

  describe.each([
    { expectedStatus: undefined, rosterState: 'pending' },
    { expectedStatus: 503, rosterState: 'failed' },
  ])('character admission with a $rosterState roster', ({ rosterState, expectedStatus }) => {
    beforeEach(() => {
      configureAuthenticatedApi()
      bootstrapAdmissionEnabled = true
      if (rosterState === 'pending') {
        rosterGate = deferred()
      } else {
        rosterDataAvailable = false
      }
    })

    it.each(CHARACTER_CHILD_REQUESTS)(
      'requests $section resources',
      async ({ section, resources }) => {
        const route = `/characters/7/${section}`

        await $fetch(route)
        expect(childRequestPaths).toStrictEqual([])
        trackPage(await createPage(route))

        await expect
          .poll(() => childRequestPaths, { timeout: 5000 })
          .toEqual(
            expect.arrayContaining(resources.map((resource) => `/api/me/characters/7/${resource}`)),
          )
        await expect.poll(() => rosterResponseStatuses[0], { timeout: 5000 }).toBe(expectedStatus)
      },
    )

    it('renders employment history without a false empty state', async () => {
      const page = trackPage(await createPage('/characters/7/history'))
      await page
        .getByText('Admission Corporation', { exact: true })
        .first()
        .waitFor({ timeout: 5000 })
      expect(await page.getByRole('heading', { name: 'No employment history' }).count()).toBe(0)
    })
  })

  it('keeps successful public SSR data over a fast IndexedDB restore without a client fetch', async () => {
    configureAuthenticatedApi()
    const persistedAt = Date.now() - 60_000
    const envelope = persistenceEnvelope({
      persistedAt,
      publicText: 'Obsolete persisted public data.',
    })
    const page = await createPersistencePage(envelope)
    await observePersistenceReadsOnNextDocument(page)
    const browserRequests: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/e2e/public-esi') {
        browserRequests.push(request.url())
      }
    })

    await navigateAndWaitForHydration(page, PUBLIC_FIXTURE_PATH)

    await expectPage(page.getByTestId('public-value')).toHaveText('Current public ESI data.')
    const observedTexts = (await readPublicHistory(page)).map(({ text }) => text)
    expect(observedTexts).toContain('Current public ESI data.')
    expect(observedTexts).not.toContain('Obsolete persisted public data.')
    expect(publicRequestCount).toBe(1)
    expect(publicBrowserRequestCount).toBe(0)
    expect(browserRequests).toStrictEqual([])
    expect(await readPersistenceReadCount(page)).toBeGreaterThan(0)
    await expect
      .poll(async () => readPublicTupleText(page), { timeout: 5000 })
      .toBe('Current public ESI data.')
  })

  it('keeps a current client fetch over a staged public fallback', async () => {
    configureAuthenticatedApi()
    const persistedText = 'Obsolete fallback staged for a client fetch.'
    const page = await createPersistencePage(
      persistenceEnvelope({ persistedAt: Date.now() - 60_000, publicText: persistedText }),
    )
    await observePersistenceReadsOnNextDocument(page)

    await navigateAndWaitForHydration(page, `${PUBLIC_FIXTURE_PATH}?source=client`)

    await expectPage(page.getByTestId('public-value')).toHaveText('Current public ESI data.')
    const observedTexts = (await readPublicHistory(page)).map(({ text }) => text)
    expect(observedTexts).toContain('Current public ESI data.')
    expect(observedTexts).not.toContain(persistedText)
    expect(publicRequestCount).toBe(1)
    expect(publicBrowserRequestCount).toBe(1)
    expect(await readPersistenceReadCount(page)).toBeGreaterThan(0)
    await expect
      .poll(async () => readPublicTupleText(page), { timeout: 5000 })
      .toBe('Current public ESI data.')
  })

  it('releases a failed public SSR fallback only after hydration completes', async () => {
    configureAuthenticatedApi()
    publicDataAvailable = false
    const persistedAt = Date.now() - 60_000
    const persistedText = 'Retained public fallback.'
    const requestsBeforeSsr = publicRequestCount
    const html = await $fetch<string>(PUBLIC_FIXTURE_PATH)

    expect(html).toContain('NO_PUBLIC_DATA')
    expect(html).not.toContain(persistedText)
    expect(publicRequestCount).toBe(requestsBeforeSsr + 1)
    expect(publicBrowserRequestCount).toBe(0)

    const page = await createPersistencePage(
      persistenceEnvelope({ persistedAt, publicText: persistedText }),
    )
    await navigateAndWaitForHydration(page, PUBLIC_FIXTURE_PATH)

    await expectPage(page.getByTestId('public-value')).toHaveText(persistedText)
    expect(await readPublicHistory(page)).toStrictEqual([{ hydrating: false, text: persistedText }])
  })

  it('settles a delayed restore before mount and keeps current SSR over staged fallback', async () => {
    configureAuthenticatedApi()
    const page = await createPersistencePage(
      persistenceEnvelope({
        persistedAt: Date.now() - 60_000,
        publicText: 'Delayed obsolete public fallback.',
      }),
    )
    await delayIndexedDbEventsOnNextDocument(page)

    await page.goto(applicationUrl(PUBLIC_FIXTURE_PATH), { waitUntil: 'domcontentloaded' })

    await expectPage(page.getByTestId('public-value')).toHaveText('Current public ESI data.')
    await expectPage(page.getByTestId('public-history')).toHaveAttribute(
      'data-client-mounted',
      'false',
    )

    await releaseIndexedDbEvents(page)
    await waitForNuxtHydration(page)

    await expectPage(page.getByTestId('public-history')).toHaveAttribute(
      'data-client-mounted',
      'true',
    )
    const observedTexts = (await readPublicHistory(page)).map(({ text }) => text)
    expect(observedTexts).toContain('Current public ESI data.')
    expect(observedTexts).not.toContain('Delayed obsolete public fallback.')
    await expect
      .poll(async () => readPublicTupleText(page), { timeout: 5000 })
      .toBe('Current public ESI data.')
  })

  it('does not expose restored private data before live identity and admission complete', async () => {
    configureAuthenticatedApi()
    characterDataAvailable = false
    admissionGate = deferred()
    const privateText = 'Quarantined private capsuleer record.'
    const page = await createPersistencePage(
      persistenceEnvelope({ persistedAt: Date.now() - 60_000, privateText }),
    )
    await observeTextOnNextDocument(page, privateText)

    await navigateAndWaitForHydration(page, '/characters/7')
    await expect.poll(() => admissionRequestCount).toBeGreaterThan(0)

    expect(await page.getByText(privateText, { exact: true }).count()).toBe(0)
    expect(await textWasObserved(page)).toBe(false)
    expect(overviewRequestCount).toBe(0)

    admissionGate.resolve()
    await page.getByText(privateText, { exact: true }).waitFor()
    expect(await page.getByRole('heading', { name: 'Record unavailable' }).count()).toBe(0)
  })

  it('retains admitted private data and its original timestamp across two failed reloads', async () => {
    configureAuthenticatedApi()
    const page = await createPersistencePage(persistenceEnvelope())

    await navigateAndWaitForHydration(page, '/characters/7')
    await page.getByText('Cached capsuleer record.', { exact: true }).waitFor()
    await expect
      .poll(async () => readPrivateTupleTimestamp(page), { timeout: 5000 })
      .toSatisfy((timestamp) => typeof timestamp === 'number')

    const originalTimestamp = Date.now() - 60_000
    await replacePrivateTupleTimestamp(page, originalTimestamp)
    characterDataAvailable = false

    for (let reload = 0; reload < 2; reload += 1) {
      const requestsBeforeReload = overviewRequestCount
      await page.reload({ waitUntil: 'domcontentloaded' })
      await waitForNuxtHydration(page)
      await page.getByText('Cached capsuleer record.', { exact: true }).waitFor()
      await expect.poll(() => overviewRequestCount).toBeGreaterThan(requestsBeforeReload)
      await expect
        .poll(async () => readPrivateTupleTimestamp(page), { timeout: 5000 })
        .toBe(originalTimestamp)
      expect(await page.getByRole('heading', { name: 'Record unavailable' }).count()).toBe(0)
    }
  })

  it('wins a logout race against pending private success and persister writes in another tab', async () => {
    configureAuthenticatedApi()
    const publicTimestamp = Date.now() - 60_000
    const publicText = 'Independent public tuple.'
    const privateText = 'Logout-race private data.'
    const obsoleteResponseText = 'Obsolete logout-race HTTP response.'
    const envelope = persistenceEnvelope({ persistedAt: publicTimestamp, privateText, publicText })
    overviewText = obsoleteResponseText
    overviewGate = deferred()
    overviewDeferredUserId = 'test-user'
    const firstPage = await createPersistencePage(envelope)
    const secondPage = trackPage(await firstPage.context().newPage())
    await installPersistenceWriteObserver(firstPage)
    await installPersistenceWriteObserver(secondPage)
    await observeTextOnNextDocument(firstPage, obsoleteResponseText)

    await navigateAndWaitForHydration(firstPage, '/characters/7')
    await firstPage.getByText(privateText, { exact: true }).waitFor()
    await expect.poll(() => overviewRequestCount).toBeGreaterThan(0)
    await navigateAndWaitForHydration(secondPage, '/characters/7')
    await Promise.all([
      firstPage.getByText(privateText, { exact: true }).waitFor(),
      secondPage.getByText(privateText, { exact: true }).waitFor(),
    ])
    await observeInvalidationChannel(firstPage)
    const writesBeforeLogout = await readPersistenceWriteCount(firstPage)

    await secondPage.bringToFront()
    await logoutThroughAuthPage(secondPage)

    await expect.poll(() => readInvalidationNotificationCount(firstPage)).toBeGreaterThan(0)
    await expectPage(firstPage.getByText(privateText, { exact: true })).toHaveCount(0)
    overviewGate.resolve()
    await expect
      .poll(() => readPersistenceWriteCount(firstPage), { timeout: 5000 })
      .toBeGreaterThan(writesBeforeLogout)

    await expectPage(firstPage.getByText(privateText, { exact: true })).toHaveCount(0)
    await expectPage(firstPage.getByText(obsoleteResponseText, { exact: true })).toHaveCount(0)
    expect(await textWasObserved(firstPage)).toBe(false)
    await expectPersistenceWritesAfterToExclude(firstPage, writesBeforeLogout, [
      privateText,
      obsoleteResponseText,
    ])
    await expectPrivatePersistenceToExclude(firstPage, privateText)
    await expectPrivatePersistenceToExclude(firstPage, obsoleteResponseText)
    await expectPublicTupleToEqual(firstPage, envelope.public[JSON.stringify(PUBLIC_QUERY_KEY)]!)
  })

  it('wins a user-switch race against an obsolete private response in another tab', async () => {
    configureAuthenticatedApi()
    const publicText = 'User-switch independent public tuple.'
    const privateText = 'Prior-owner private data.'
    const obsoleteResponseText = 'Obsolete prior-owner HTTP response.'
    const envelope = persistenceEnvelope({
      persistedAt: Date.now() - 60_000,
      privateText,
      publicText,
    })
    overviewGate = deferred()
    overviewDeferredUserId = 'test-user'
    overviewText = obsoleteResponseText
    const firstPage = await createPersistencePage(envelope)
    const secondPage = trackPage(await firstPage.context().newPage())
    await installPersistenceWriteObserver(firstPage)
    await observeTextOnNextDocument(firstPage, obsoleteResponseText)

    await navigateAndWaitForHydration(firstPage, '/characters/7')
    await firstPage.getByText(privateText, { exact: true }).waitFor()
    await expect.poll(() => overviewRequestCount).toBeGreaterThan(0)
    await navigateAndWaitForHydration(secondPage, '/characters/7')
    await Promise.all([
      firstPage.getByText(privateText, { exact: true }).waitFor(),
      secondPage.getByText(privateText, { exact: true }).waitFor(),
    ])
    await observeInvalidationChannel(firstPage)
    const writesBeforeSwitch = await readPersistenceWriteCount(firstPage)

    currentUserId = 'next-user'
    rosterCharacters = []
    await secondPage.reload({ waitUntil: 'domcontentloaded' })
    await waitForNuxtHydration(secondPage)

    await expect.poll(() => readInvalidationNotificationCount(firstPage)).toBeGreaterThan(0)
    await expectPage(firstPage.getByText(privateText, { exact: true })).toHaveCount(0)
    overviewGate.resolve()
    await expect
      .poll(() => readPersistenceWriteCount(firstPage), { timeout: 5000 })
      .toBeGreaterThan(writesBeforeSwitch)

    await expectPage(firstPage.getByText(privateText, { exact: true })).toHaveCount(0)
    await expectPage(firstPage.getByText(obsoleteResponseText, { exact: true })).toHaveCount(0)
    expect(await textWasObserved(firstPage)).toBe(false)
    await expectPersistenceWritesAfterToExclude(firstPage, writesBeforeSwitch, [
      privateText,
      obsoleteResponseText,
    ])
    await expectPrivatePersistenceToExclude(firstPage, privateText)
    await expectPrivatePersistenceToExclude(firstPage, obsoleteResponseText)
    await expectPublicTupleToEqual(firstPage, envelope.public[JSON.stringify(PUBLIC_QUERY_KEY)]!)
  })

  it('detects durable invalidation on pageshow, focus, and visibility after missed notifications', async () => {
    configureAuthenticatedApi()
    overviewGate = deferred()
    overviewDeferredUserId = 'test-user'
    const privateText = 'Missed-notification private data.'
    const envelope = persistenceEnvelope({
      persistedAt: Date.now() - 60_000,
      privateText,
      publicText: 'Lifecycle-independent public tuple.',
    })
    for (const lifecycleEvent of ['pageshow', 'focus', 'visibilitychange']) {
      const page = await createPersistencePage(envelope)
      await disableInvalidationNotificationsOnNextDocument(page)
      await delayLifecycleChecksOnNextDocument(page)
      await installPersistenceWriteObserver(page)
      await navigateAndWaitForHydration(page, '/characters/7')
      await page.getByText(privateText, { exact: true }).waitFor()
      await waitForPersistenceWritesToSettle(page)

      await advanceDurableInvalidationGeneration(page)
      expect(await page.getByText(privateText, { exact: true }).isVisible()).toBe(true)
      await page.evaluate((eventType) => {
        const browserState = globalThis as typeof globalThis & {
          e2eQueryPersistenceLifecycleEnabled?: boolean
        }
        browserState.e2eQueryPersistenceLifecycleEnabled = true
        if (eventType === 'visibilitychange' && document.visibilityState !== 'visible') {
          throw new Error('The visibility lifecycle fixture must be visible.')
        }
        const target = eventType === 'visibilitychange' ? document : window
        target.dispatchEvent(new Event(eventType))
      }, lifecycleEvent)

      await expectPage(page.getByText(privateText, { exact: true })).toHaveCount(0)
      await expectPrivatePersistenceToExclude(page, privateText)
      await expectPublicTupleToEqual(page, envelope.public[JSON.stringify(PUBLIC_QUERY_KEY)]!)
    }
  })

  it('fails private persistence closed when the durable control check is invalid', async () => {
    configureAuthenticatedApi()
    const obsoletePrivateText = 'Private data behind an invalid durable control.'
    overviewText = 'Live authorized private query.'
    publicFixtureText = 'Live public data with private persistence disabled.'
    const page = await createPersistencePage(
      persistenceEnvelope({
        persistedAt: Date.now() - 60_000,
        privateText: obsoletePrivateText,
        publicText: 'Prior public data.',
      }),
      { invalidControl: true },
    )
    await installPersistenceWriteObserver(page)
    await observeTextOnNextDocument(page, obsoletePrivateText)

    await navigateAndWaitForHydration(page, '/characters/7')
    await page.getByText(overviewText, { exact: true }).waitFor()
    await expect.poll(() => readPersistenceWriteCount(page), { timeout: 5000 }).toBeGreaterThan(0)

    const publicPage = trackPage(await page.context().newPage())
    await navigateAndWaitForHydration(publicPage, PUBLIC_FIXTURE_PATH)
    await expectPage(publicPage.getByTestId('public-value')).toHaveText(publicFixtureText)
    await expect
      .poll(async () => readPublicTupleText(publicPage), { timeout: 5000 })
      .toBe(publicFixtureText)

    const records = await readPersistenceRecords(publicPage)
    expect(records.control).toStrictEqual({ invalidationGeneration: null, version: 1 })
    expect(records.envelope?.characters).toStrictEqual({})
    expect(await textWasObserved(page)).toBe(false)
    expect(JSON.stringify(records.envelope)).not.toContain(obsoletePrivateText)
    expect(JSON.stringify(records.envelope)).not.toContain(overviewText)
  })

  it('keeps dashboard navigation keyboard accessible on mobile', async () => {
    apiAvailable = true
    apiServer.setAllowedOrigin(applicationOrigin())
    const page = await createPage('/')
    await page.setViewportSize({ height: 844, width: 390 })
    await waitForNuxtHydration(page)

    const persistentSidebar = page.locator('.dashboard-sidebar--persistent')
    const trigger = page.getByRole('button', { name: 'Open navigation' })
    expect(await page.content()).toContain('dashboard-shell')
    expect(await persistentSidebar.isHidden()).toBe(true)
    expect(await trigger.isVisible()).toBe(true)

    await trigger.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Close navigation' }).waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Open navigation' }).waitFor({ state: 'visible' })
    expect(await page.getByRole('button', { name: 'Close navigation' }).isHidden()).toBe(true)
    expect(await trigger.evaluate((element) => document.activeElement === element)).toBe(true)

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(hasHorizontalOverflow).toBe(false)
  })

  it('keeps destination focus after navigating from the mobile drawer', async () => {
    apiAvailable = true
    apiServer.setAllowedOrigin(applicationOrigin())
    const page = await createPage('/')
    await page.setViewportSize({ height: 844, width: 390 })
    await waitForNuxtHydration(page)
    const trigger = page.getByRole('button', { name: 'Open navigation' })

    await trigger.click()
    const characterLink = page.locator('.dashboard-sidebar--drawer a[href="/characters"]', {
      hasText: 'CHARACTERS',
    })
    await characterLink.waitFor({ state: 'visible' })
    await characterLink.click()
    await page.waitForURL((url) => url.pathname === '/characters')
    await page.getByRole('button', { name: 'Close navigation' }).waitFor({ state: 'hidden' })
    await expect
      .poll(() =>
        page.evaluate(() => ({
          activeElementId: document.activeElement?.id,
          activeElementLabel: document.activeElement?.getAttribute('aria-label'),
          mainCount: document.querySelectorAll('#main-content').length,
        })),
      )
      .toEqual({ activeElementId: 'main-content', activeElementLabel: null, mainCount: 1 })
  })

  it('uses persistent navigation on the supported desktop layout', async () => {
    apiAvailable = true
    apiServer.setAllowedOrigin(applicationOrigin())
    const page = await createPage('/')
    await page.setViewportSize({ height: 800, width: 1280 })

    expect(await page.content()).toContain('dashboard-shell')
    expect(await page.locator('.auth-shell').count()).toBe(0)
    expect(await page.locator('.dashboard-sidebar--persistent').isVisible()).toBe(true)
    expect(await page.getByRole('button', { name: 'Open navigation' }).isHidden()).toBe(true)
  })

  it('keeps theme text and focus indicators at accessible contrast', async () => {
    apiAvailable = true
    apiServer.setAllowedOrigin(applicationOrigin())
    const page = await createPage('/')
    const themes = ['gallente', 'high-sec', 'amarr', 'minmatar', 'caldari']
    const textTokens = [
      '--ui-text',
      '--ui-text-muted',
      '--ui-text-subtle',
      '--ui-text-faint',
      '--ui-primary',
      '--ui-success',
      '--ui-warning',
      '--ui-danger',
    ]
    const backgroundTokens = [
      '--ui-canvas',
      '--ui-surface',
      '--ui-surface-solid',
      '--ui-surface-raised',
      '--ui-control',
    ]

    for (const theme of themes) {
      const tokens = await page.evaluate(
        ({ selectedTheme, tokenNames }) => {
          document.documentElement.dataset.theme = selectedTheme
          const style = getComputedStyle(document.documentElement)
          return Object.fromEntries(
            tokenNames.map((name) => [name, style.getPropertyValue(name).trim()]),
          )
        },
        {
          selectedTheme: theme,
          tokenNames: [...textTokens, ...backgroundTokens, '--ui-focus-ring', '--ui-on-primary'],
        },
      )

      for (const textToken of textTokens) {
        for (const backgroundToken of backgroundTokens) {
          expect(
            contrastRatio(tokens[textToken]!, tokens[backgroundToken]!, tokens['--ui-canvas']!),
            `${theme} ${textToken} on ${backgroundToken}`,
          ).toBeGreaterThanOrEqual(4.5)
        }
      }
      expect(
        contrastRatio(tokens['--ui-focus-ring']!, tokens['--ui-canvas']!),
        `${theme} focus ring on canvas`,
      ).toBeGreaterThanOrEqual(3)
      expect(
        contrastRatio(tokens['--ui-on-primary']!, tokens['--ui-primary']!),
        `${theme} primary control text`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('skips to one main target and moves focus only for represented page changes', async () => {
    apiAvailable = true
    apiServer.setAllowedOrigin(applicationOrigin())
    const page = await createPage('/admin/login')
    await waitForNuxtHydration(page)
    const skipLink = page.getByRole('link', { name: 'Skip to main content' })
    const main = page.locator('#main-content')

    expect(await page.locator('main').count()).toBe(1)
    expect(await main.getAttribute('tabindex')).toBe('-1')
    expect(await main.evaluate((element) => document.activeElement === element)).toBe(false)

    await page.keyboard.press('Tab')
    expect(await skipLink.evaluate((element) => document.activeElement === element)).toBe(true)
    await page.keyboard.press('Enter')
    expect(await main.evaluate((element) => document.activeElement === element)).toBe(true)
    expect(
      await main.evaluate((element) => {
        const style = getComputedStyle(element)
        return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth }
      }),
    ).toStrictEqual({ outlineStyle: 'solid', outlineWidth: '2px' })

    for (const theme of ['gallente', 'high-sec', 'amarr', 'minmatar', 'caldari']) {
      const outlineColor = await main.evaluate((element, selectedTheme) => {
        document.documentElement.dataset.theme = selectedTheme
        return getComputedStyle(element).outlineColor
      }, theme)
      expect(outlineColor).not.toBe('transparent')
      expect(outlineColor).not.toBe('rgba(0, 0, 0, 0)')
    }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await main.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe(
      '0s',
    )

    const dashboardLink = page.getByRole('link', { name: 'RETURN TO DASHBOARD' })
    await dashboardLink.focus()
    await page.evaluate(async () => {
      const nuxtApp = (
        window as typeof window & {
          useNuxtApp: () => { $router: { push: (path: string) => Promise<unknown> } }
        }
      ).useNuxtApp()
      await nuxtApp.$router.push(`${location.pathname}?source=keyboard`)
    })
    await page.waitForURL(/source=keyboard/)
    expect(await dashboardLink.evaluate((element) => document.activeElement === element)).toBe(true)

    await page.evaluate(async () => {
      const nuxtApp = (
        window as typeof window & {
          useNuxtApp: () => { $router: { push: (path: string) => Promise<unknown> } }
        }
      ).useNuxtApp()
      await nuxtApp.$router.push(`${location.pathname}${location.search}#administrator-login`)
    })
    await page.waitForURL(/#administrator-login$/)
    expect(await dashboardLink.evaluate((element) => document.activeElement === element)).toBe(true)

    await dashboardLink.click()
    await expect.poll(() => page.title(), { timeout: 5000 }).toBe('Overview // EVE Space')
    await expect
      .poll(
        () =>
          page.locator('#main-content').evaluate((element) => document.activeElement === element),
        { timeout: 5000 },
      )
      .toBe(true)
    await expect
      .poll(() => page.locator('.nuxt-route-announcer [role="status"]').textContent())
      .toBe('Overview // EVE Space')

    await page.goto(new URL('/characters', applicationOrigin()).toString())
    expect(await page.locator('main').count()).toBe(1)
    expect(await page.locator('#main-content').getAttribute('tabindex')).toBe('-1')
  })
})

type PersistedEsiQuery =
  | { readonly kind: 'public-esi' }
  | { readonly kind: 'character-esi'; readonly characterId: number }

type PersistedQueryTuple = [
  data: unknown,
  error: null,
  when: number,
  meta: { readonly esiPersistence: PersistedEsiQuery },
]

interface QueryPersistenceEnvelope {
  version: 1
  invalidationGeneration: number
  public: Record<string, PersistedQueryTuple>
  characters: Record<
    string,
    {
      ownerUserId: string
      admissionRevision: string
      cache: Record<string, PersistedQueryTuple>
    }
  >
  organizations: Record<string, never>
}

interface Deferred {
  readonly promise: Promise<void>
  readonly resolve: () => void
}

async function handleApiRequest(request: IncomingMessage) {
  if (!apiAvailable) {
    return {
      body: { code: 'TEST_FAILURE', message: 'API unavailable for SSR test.' },
      status: 403,
    }
  }

  const path = request.url?.split('?', 1)[0]
  if (path === '/api/e2e/public-esi') {
    return publicEsiApiResponse(request)
  }
  if (path === '/auth/session') {
    return sessionApiResponse(request)
  }
  if (path === '/auth/logout' && request.method === 'POST') {
    currentUserId = null
    return { body: null }
  }
  if (path === '/auth/config') {
    return { body: { attachUrl: '', configured: false, loginUrl: '' } }
  }
  if (path === '/api/admin/session') {
    return { body: { authenticated: false } }
  }
  if (path === '/api/me/cache-admission') {
    return cacheAdmissionApiResponse()
  }
  if (path?.startsWith('/api/me/characters')) {
    const response = await characterApiResponse(path)
    if (response) {
      return response
    }
  }
  if (path === '/api/status') {
    return { body: systemStatusResponse() }
  }
  if (path === '/api/modules') {
    return {
      body: {
        enabledModuleIds: [],
        shellNavigationOrder: { character: [], dashboard: [] },
      },
    }
  }
  return { body: { code: 'NOT_FOUND', message: 'Not found.' }, status: 404 }
}

function publicEsiApiResponse(request: IncomingMessage) {
  publicRequestCount += 1
  if (request.headers.origin) {
    publicBrowserRequestCount += 1
  }
  return publicDataAvailable
    ? { body: { marker: 'PUBLIC_ESI_FIXTURE', text: publicFixtureText } }
    : esiUnavailable()
}

async function characterApiResponse(path: string) {
  if (path === '/api/me/characters') {
    if (rosterGate) {
      await rosterGate.promise
    }
    rosterResponseStatuses.push(rosterDataAvailable ? 200 : 503)
    return rosterDataAvailable ? { body: { characters: rosterCharacters } } : esiUnavailable()
  }
  if (path === '/api/me/characters/7') {
    overviewRequestCount += 1
    const requestingUserId = currentUserId
    const responseText = overviewText
    if (overviewGate && requestingUserId === overviewDeferredUserId) {
      await overviewGate.promise
    }
    return characterDataAvailable ? { body: overviewResponse(responseText) } : esiUnavailable()
  }
  if (path.startsWith('/api/me/characters/7/')) {
    childRequestPaths.push(path)
    return path === '/api/me/characters/7/history' ? { body: historyResponse() } : esiUnavailable()
  }
  return undefined
}

function sessionApiResponse(request: IncomingMessage) {
  sessionRequestCount += 1
  return currentUserId
    ? {
        body: {
          account: {
            mainCharacter: { characterId: 7, name: 'Persistent Pilot' },
            userId: currentUserId,
          },
          authenticated: true,
          ...(bootstrapAdmissionEnabled &&
            new URL(request.url!, apiServer.origin).searchParams.get('includeAdmission') ===
              'true' && { cacheAdmission: bootstrapCacheAdmission(currentUserId) }),
        },
      }
    : { body: { authenticated: false } }
}

async function cacheAdmissionApiResponse() {
  admissionRequestCount += 1
  const admittedUserId = currentUserId
  if (!admittedUserId) {
    return { body: { code: 'AUTH_REQUIRED', message: 'Authentication required.' }, status: 401 }
  }
  const gate = admissionGate
  if (gate) {
    await gate.promise
  }
  return { body: cacheAdmission(admittedUserId) }
}

function bootstrapCacheAdmission(userId: string) {
  return bootstrapAdmissionUnavailable ? null : cacheAdmission(userId)
}

function historyResponse() {
  return {
    characterId: 7,
    history: [
      {
        corporation: { id: 98_000_001, isNpc: false, name: 'Admission Corporation' },
        isDeleted: false,
        recordId: 1,
        startDate: '2020-01-01T00:00:00.000Z',
      },
    ],
  }
}

function resetFixtureState() {
  childRequestPaths.length = 0
  rosterResponseStatuses.length = 0
  rosterGate?.resolve()
  rosterGate = undefined
  bootstrapAdmissionUnavailable = false
  admissionGate?.resolve()
  overviewGate?.resolve()
  apiAvailable = false
  characterDataAvailable = true
  rosterDataAvailable = true
  currentUserId = 'test-user'
  publicDataAvailable = true
  publicFixtureText = 'Current public ESI data.'
  publicRequestCount = 0
  publicBrowserRequestCount = 0
  overviewRequestCount = 0
  admissionRequestCount = 0
  bootstrapAdmissionEnabled = false
  sessionRequestCount = 0
  overviewText = 'Cached capsuleer record.'
  admissionGate = undefined
  overviewGate = undefined
  overviewDeferredUserId = undefined
  rosterCharacters = []
}

function configureAuthenticatedApi() {
  apiAvailable = true
  currentUserId = 'test-user'
  rosterCharacters = [ownedCharacter()]
  apiServer.setAllowedOrigin(applicationOrigin())
}

function cacheAdmission(userId: string) {
  return {
    characters: [
      {
        characterId: 7,
        admissionRevision:
          userId === 'test-user' ? 'character-revision-1' : 'next-character-revision-1',
      },
    ],
    organization: null,
    userId,
  }
}

function esiUnavailable() {
  return {
    body: { code: 'ESI_UNAVAILABLE', message: 'EVE Online ESI is unavailable.' },
    status: 503,
  }
}

function systemStatusResponse() {
  return {
    cachedUntil: '2026-09-03T11:00:15.000Z',
    checkedAt: '2026-09-03T11:00:00.000Z',
    services: {
      api: { status: 'operational', uptimeSeconds: 100 },
      database: { latencyMs: 1, status: 'operational' },
      esi: {
        checkedAt: '2026-09-03T11:00:00.000Z',
        errorBudgetRemaining: 100,
        errorBudgetResetSeconds: 10,
        latencyMs: 2,
        players: 20_000,
        serverVersion: 'test',
        startedAt: null,
        status: 'operational',
        vip: false,
      },
      sde: {
        buildNumber: 3_503_375,
        checkedAt: '2026-09-03T11:00:00.000Z',
        ingestVersion: 4,
        ingestedAt: '2026-09-03T10:00:00.000Z',
        latencyMs: 1,
        status: 'operational',
      },
    },
    status: 'operational',
  }
}

function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function persistenceEnvelope(
  options: {
    readonly persistedAt?: number
    readonly privateText?: string
    readonly publicText?: string
  } = {},
): QueryPersistenceEnvelope {
  const persistedAt = options.persistedAt ?? Date.now()
  const envelope: QueryPersistenceEnvelope = {
    characters: {},
    invalidationGeneration: 0,
    organizations: {},
    public: {},
    version: 1,
  }
  if (options.publicText) {
    envelope.public[JSON.stringify(PUBLIC_QUERY_KEY)] = persistedTuple(
      { marker: 'PUBLIC_ESI_FIXTURE', text: options.publicText },
      persistedAt,
      { kind: 'public-esi' },
    )
  }
  if (options.privateText) {
    envelope.characters['7'] = {
      admissionRevision: 'character-revision-1',
      cache: {
        [JSON.stringify(PRIVATE_QUERY_KEY)]: persistedTuple(
          overviewResponse(options.privateText),
          persistedAt,
          { kind: 'character-esi', characterId: 7 },
        ),
      },
      ownerUserId: 'test-user',
    }
  }
  return envelope
}

function persistedTuple(
  data: unknown,
  when: number,
  esiPersistence: PersistedEsiQuery,
): PersistedQueryTuple {
  return [data, null, when, { esiPersistence }]
}

async function createPersistencePage(
  envelope: QueryPersistenceEnvelope,
  options: { readonly invalidControl?: boolean } = {},
) {
  const browser = useTestContext().browser
  if (!browser) {
    throw new Error('The Nuxt browser is unavailable.')
  }
  const context = await browser.newContext()
  managedContexts.add(context)
  const page = trackPage(await context.newPage())
  await page.goto(applicationUrl('/favicon.svg'), { waitUntil: 'load' })
  await writePersistenceRecords(
    page,
    envelope,
    options.invalidControl
      ? { invalid: true }
      : { invalidationGeneration: envelope.invalidationGeneration, version: 1 },
  )
  return page
}

function trackPage(page: Page) {
  managedPages.add(page)
  return page
}

function applicationUrl(path: string) {
  return new URL(path, applicationOrigin()).toString()
}

function applicationOrigin() {
  const origin = useTestContext().url
  if (!origin) {
    throw new Error('The Nuxt test server URL is unavailable.')
  }
  return origin
}

async function navigateAndWaitForHydration(page: Page, path: string) {
  await page.goto(applicationUrl(path), { waitUntil: 'domcontentloaded' })
  await waitForNuxtHydration(page)
}

async function waitForNuxtHydration(page: Page) {
  await page.waitForFunction(
    () =>
      (window as typeof window & { useNuxtApp?: () => { isHydrating: boolean } }).useNuxtApp?.()
        .isHydrating === false,
    undefined,
    { timeout: 10_000 },
  )
}

async function writePersistenceRecords(
  page: Page,
  envelope: QueryPersistenceEnvelope,
  control: unknown,
) {
  await page.evaluate(
    async ({
      cacheKey,
      controlKey,
      databaseName,
      databaseVersion,
      envelopeValue,
      storeName,
      value,
    }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName, databaseVersion)
        request.addEventListener('upgradeneeded', () => {
          if (!request.result.objectStoreNames.contains(storeName)) {
            request.result.createObjectStore(storeName)
          }
        })
        request.addEventListener('success', () => resolve(request.result), { once: true })
        request.addEventListener('error', () => reject(request.error), { once: true })
        request.addEventListener(
          'blocked',
          () => reject(new Error('IndexedDB open was blocked.')),
          {
            once: true,
          },
        )
      })
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readwrite')
        const store = transaction.objectStore(storeName)
        store.put(JSON.stringify(envelopeValue), cacheKey)
        store.put(value, controlKey)
        transaction.addEventListener('complete', () => resolve(), { once: true })
        transaction.addEventListener('error', () => reject(transaction.error), { once: true })
        transaction.addEventListener('abort', () => reject(transaction.error), { once: true })
      })
      database.close()
    },
    {
      cacheKey: PERSISTED_CACHE_KEY,
      controlKey: INVALIDATION_CONTROL_KEY,
      databaseName: DATABASE_NAME,
      databaseVersion: DATABASE_VERSION,
      envelopeValue: envelope,
      storeName: OBJECT_STORE_NAME,
      value: control,
    },
  )
}

async function readPersistenceRecords(page: Page) {
  return page.evaluate(
    async ({ cacheKey, controlKey, databaseName, databaseVersion, storeName }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName, databaseVersion)
        request.addEventListener('success', () => resolve(request.result), { once: true })
        request.addEventListener('error', () => reject(request.error), { once: true })
        request.addEventListener(
          'blocked',
          () => reject(new Error('IndexedDB open was blocked.')),
          {
            once: true,
          },
        )
      })
      const transaction = database.transaction(storeName, 'readonly')
      const store = transaction.objectStore(storeName)
      const read = (key: string) =>
        new Promise<unknown>((resolve, reject) => {
          const request = store.get(key)
          request.addEventListener('success', () => resolve(request.result), { once: true })
          request.addEventListener('error', () => reject(request.error), { once: true })
        })
      const [storedEnvelope, control] = await Promise.all([read(cacheKey), read(controlKey)])
      database.close()
      return {
        control,
        envelope:
          typeof storedEnvelope === 'string'
            ? (JSON.parse(storedEnvelope) as QueryPersistenceEnvelope)
            : null,
      }
    },
    {
      cacheKey: PERSISTED_CACHE_KEY,
      controlKey: INVALIDATION_CONTROL_KEY,
      databaseName: DATABASE_NAME,
      databaseVersion: DATABASE_VERSION,
      storeName: OBJECT_STORE_NAME,
    },
  )
}

async function replacePrivateTupleTimestamp(page: Page, timestamp: number) {
  const records = await readPersistenceRecords(page)
  const envelope = records.envelope
  const tuple = envelope?.characters['7']?.cache[JSON.stringify(PRIVATE_QUERY_KEY)]
  if (!envelope || !tuple) {
    throw new Error('The persisted private tuple is missing.')
  }
  tuple[2] = timestamp
  await writePersistenceRecords(page, envelope, records.control)
}

async function readPublicTupleText(page: Page) {
  const tuple = (await readPersistenceRecords(page)).envelope?.public[
    JSON.stringify(PUBLIC_QUERY_KEY)
  ]
  const data = tuple?.[0]
  return data && typeof data === 'object' && 'text' in data ? data.text : null
}

async function readPrivateTupleTimestamp(page: Page) {
  return (await readPersistenceRecords(page)).envelope?.characters['7']?.cache[
    JSON.stringify(PRIVATE_QUERY_KEY)
  ]?.[2]
}

async function readPublicHistory(page: Page) {
  return page.evaluate(
    () =>
      (
        globalThis as typeof globalThis & {
          e2ePublicHistory?: Array<{ hydrating: boolean; text: string }>
        }
      ).e2ePublicHistory ?? [],
  )
}

async function expectPrivatePersistenceToExclude(page: Page, obsoleteText: string) {
  await expect
    .poll(async () => JSON.stringify((await readPersistenceRecords(page)).envelope), {
      timeout: 5000,
    })
    .not.toContain(obsoleteText)
}

async function expectPublicTupleToEqual(page: Page, expected: PersistedQueryTuple) {
  await expect
    .poll(
      async () =>
        (await readPersistenceRecords(page)).envelope?.public[JSON.stringify(PUBLIC_QUERY_KEY)],
      { timeout: 5000 },
    )
    .toEqual(expected)
}

async function delayIndexedDbEventsOnNextDocument(page: Page) {
  await page.addInitScript(() => {
    const browserState = globalThis as typeof globalThis & {
      e2eReleaseIndexedDbEvents?: () => void
    }
    const pendingEvents: Array<() => void> = []
    let released = false
    const addEventListener = EventTarget.prototype.addEventListener
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (this instanceof IDBRequest && (type === 'success' || type === 'error') && listener) {
        const delayedListener: EventListener = (event) => {
          const dispatch = () => {
            if (typeof listener === 'function') {
              listener(event)
            } else {
              listener.handleEvent(event)
            }
          }
          if (released) {
            dispatch()
          } else {
            pendingEvents.push(dispatch)
          }
        }
        addEventListener.call(this, type, delayedListener, options)
        return
      }
      addEventListener.call(this, type, listener, options)
    }
    browserState.e2eReleaseIndexedDbEvents = () => {
      released = true
      for (const dispatch of pendingEvents.splice(0)) {
        dispatch()
      }
    }
  })
}

async function releaseIndexedDbEvents(page: Page) {
  await page.evaluate(() => {
    const release = (globalThis as typeof globalThis & { e2eReleaseIndexedDbEvents?: () => void })
      .e2eReleaseIndexedDbEvents
    if (!release) {
      throw new Error('The IndexedDB release control is unavailable.')
    }
    release()
  })
}

async function installPersistenceWriteObserver(page: Page) {
  await page.addInitScript(
    ({ cacheKey }) => {
      const browserState = globalThis as typeof globalThis & {
        e2ePersistenceWriteCount?: number
        e2ePersistenceWrites?: string[]
      }
      browserState.e2ePersistenceWriteCount = 0
      browserState.e2ePersistenceWrites = []
      const put = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (value, key) {
        if (key === cacheKey) {
          browserState.e2ePersistenceWriteCount! += 1
          if (typeof value === 'string') {
            browserState.e2ePersistenceWrites!.push(value)
          }
        }
        return key === undefined ? put.call(this, value) : put.call(this, value, key)
      }
    },
    { cacheKey: PERSISTED_CACHE_KEY },
  )
}

async function observePersistenceReadsOnNextDocument(page: Page) {
  await page.addInitScript(
    ({ cacheKey }) => {
      const browserState = globalThis as typeof globalThis & {
        e2ePersistenceReadCount?: number
      }
      browserState.e2ePersistenceReadCount = 0
      const get = IDBObjectStore.prototype.get
      IDBObjectStore.prototype.get = function (key) {
        if (key === cacheKey) {
          browserState.e2ePersistenceReadCount! += 1
        }
        return get.call(this, key)
      }
    },
    { cacheKey: PERSISTED_CACHE_KEY },
  )
}

async function observeTextOnNextDocument(page: Page, text: string) {
  await page.addInitScript((observedText) => {
    const browserState = globalThis as typeof globalThis & { e2eObservedText?: boolean }
    browserState.e2eObservedText = false
    const record = () => {
      if (document.body?.innerText.includes(observedText)) {
        browserState.e2eObservedText = true
      }
    }
    new MutationObserver(record).observe(document, {
      characterData: true,
      childList: true,
      subtree: true,
    })
    document.addEventListener('DOMContentLoaded', record, { once: true })
  }, text)
}

async function textWasObserved(page: Page) {
  return page.evaluate(
    () =>
      (globalThis as typeof globalThis & { e2eObservedText?: boolean }).e2eObservedText ?? false,
  )
}

async function readPersistenceWriteCount(page: Page) {
  return page.evaluate(
    () =>
      (globalThis as typeof globalThis & { e2ePersistenceWriteCount?: number })
        .e2ePersistenceWriteCount ?? 0,
  )
}

async function readPersistenceReadCount(page: Page) {
  return page.evaluate(
    () =>
      (globalThis as typeof globalThis & { e2ePersistenceReadCount?: number })
        .e2ePersistenceReadCount ?? 0,
  )
}

async function waitForPersistenceWritesToSettle(page: Page) {
  await page.waitForTimeout(500)
  const settledCount = await readPersistenceWriteCount(page)
  await page.waitForTimeout(250)
  expect(await readPersistenceWriteCount(page)).toBe(settledCount)
}

async function expectPersistenceWritesAfterToExclude(
  page: Page,
  startIndex: number,
  obsoleteTexts: readonly string[],
) {
  const writes = await page.evaluate(
    (index) =>
      (
        globalThis as typeof globalThis & {
          e2ePersistenceWrites?: string[]
        }
      ).e2ePersistenceWrites?.slice(index) ?? [],
    startIndex,
  )
  expect(writes.length).toBeGreaterThan(0)
  for (const write of writes) {
    for (const obsoleteText of obsoleteTexts) {
      expect(write).not.toContain(obsoleteText)
    }
  }
}

async function observeInvalidationChannel(page: Page) {
  await page.evaluate(() => {
    const browserState = globalThis as typeof globalThis & {
      e2eInvalidationChannel?: BroadcastChannel
      e2eInvalidationNotificationCount?: number
    }
    browserState.e2eInvalidationNotificationCount = 0
    browserState.e2eInvalidationChannel = new BroadcastChannel(
      'eve-space-esi-query-cache-invalidation',
    )
    browserState.e2eInvalidationChannel.addEventListener('message', () => {
      browserState.e2eInvalidationNotificationCount! += 1
    })
  })
}

async function readInvalidationNotificationCount(page: Page) {
  return page.evaluate(
    () =>
      (globalThis as typeof globalThis & { e2eInvalidationNotificationCount?: number })
        .e2eInvalidationNotificationCount ?? 0,
  )
}

async function disableInvalidationNotificationsOnNextDocument(page: Page) {
  await page.addInitScript(() => {
    class SilentBroadcastChannel extends EventTarget {
      readonly name: string
      onmessage: ((event: MessageEvent) => void) | null = null
      onmessageerror: ((event: MessageEvent) => void) | null = null

      constructor(name: string) {
        super()
        this.name = name
      }

      close() {}

      postMessage() {}
    }
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      value: SilentBroadcastChannel,
      writable: true,
    })
  })
}

async function delayLifecycleChecksOnNextDocument(page: Page) {
  await page.addInitScript(() => {
    const browserState = globalThis as typeof globalThis & {
      e2eQueryPersistenceLifecycleEnabled?: boolean
    }
    browserState.e2eQueryPersistenceLifecycleEnabled = false
    const addEventListener = EventTarget.prototype.addEventListener
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      const delayed =
        listener &&
        ((this === window && (type === 'pageshow' || type === 'focus')) ||
          (this === document && type === 'visibilitychange'))
      if (!delayed) {
        addEventListener.call(this, type, listener, options)
        return
      }
      const wrappedListener: EventListener = (event) => {
        if (!browserState.e2eQueryPersistenceLifecycleEnabled) {
          return
        }
        if (typeof listener === 'function') {
          listener(event)
        } else {
          listener.handleEvent(event)
        }
      }
      addEventListener.call(this, type, wrappedListener, options)
    }
  })
}

async function advanceDurableInvalidationGeneration(page: Page) {
  const records = await readPersistenceRecords(page)
  if (!records.envelope) {
    throw new Error('The persisted envelope is missing.')
  }
  const control = records.control as { invalidationGeneration?: unknown }
  const currentGeneration = control.invalidationGeneration
  if (typeof currentGeneration !== 'number') {
    throw new Error('The durable generation is invalid.')
  }
  records.envelope.invalidationGeneration = currentGeneration + 1
  records.envelope.characters = {}
  await writePersistenceRecords(page, records.envelope, {
    invalidationGeneration: currentGeneration + 1,
    version: 1,
  })
}

async function logoutThroughAuthPage(page: Page) {
  await navigateAndWaitForHydration(page, '/auth')
  const logout = page.getByRole('button', { name: 'LOG OUT' })
  await logout.waitFor({ state: 'visible' })
  await logout.evaluate((button) => button.click())
  await expect.poll(() => currentUserId).toBeNull()
}

function contrastRatio(foreground: string, background: string, backdrop = '#fff') {
  const backdropColor = parseColor(backdrop)
  const foregroundLuminance = relativeLuminance(
    compositeColor(parseColor(foreground), backdropColor),
  )
  const backgroundLuminance = relativeLuminance(
    compositeColor(parseColor(background), backdropColor),
  )
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  )
}

type Color = [number, number, number, number]

function parseColor(value: string): Color {
  if (/^#[\da-f]{3}$/i.test(value)) {
    return [
      ...[value[1]!, value[2]!, value[3]!].map((channel) => Number.parseInt(channel.repeat(2), 16)),
      1,
    ] as Color
  }
  if (/^#[\da-f]{4}$/i.test(value)) {
    return [
      ...[value[1]!, value[2]!, value[3]!].map((channel) => Number.parseInt(channel.repeat(2), 16)),
      Number.parseInt(value[4]!.repeat(2), 16) / 255,
    ] as Color
  }
  if (/^#[\da-f]{6}$/i.test(value)) {
    return [
      Number.parseInt(value.slice(1, 3), 16),
      Number.parseInt(value.slice(3, 5), 16),
      Number.parseInt(value.slice(5, 7), 16),
      1,
    ]
  }
  if (/^#[\da-f]{8}$/i.test(value)) {
    return [
      Number.parseInt(value.slice(1, 3), 16),
      Number.parseInt(value.slice(3, 5), 16),
      Number.parseInt(value.slice(5, 7), 16),
      Number.parseInt(value.slice(7, 9), 16) / 255,
    ]
  }
  const channels = value.match(/[\d.]+/g)?.map(Number)
  if (channels?.length === 3) {
    return [...channels, 1] as Color
  }
  if (channels?.length === 4) {
    return channels as Color
  }
  throw new Error(`Unsupported color: ${value}`)
}

function compositeColor(color: Color, backdrop: Color): [number, number, number] {
  const alpha = color[3]
  return [
    color[0] * alpha + backdrop[0] * (1 - alpha),
    color[1] * alpha + backdrop[1] * (1 - alpha),
    color[2] * alpha + backdrop[2] * (1 - alpha),
  ]
}

function relativeLuminance(color: [number, number, number]) {
  const [red, green, blue] = color.map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return red! * 0.2126 + green! * 0.7152 + blue! * 0.0722
}

function ownedCharacter() {
  return {
    alliance: null,
    allianceId: null,
    birthday: '2020-01-01T00:00:00.000Z',
    bloodline: 'Deteis',
    characterId: 7,
    corporation: {
      id: 98_000_001,
      memberCount: 1,
      name: 'Persistence Corporation',
      ticker: 'CACHE',
    },
    corporationId: 98_000_001,
    gender: 'Female',
    isMain: true,
    location: null,
    name: 'Persistent Pilot',
    race: 'Caldari',
    securityStatus: 1,
    ship: null,
    skills: null,
  }
}

function overviewResponse(bio = 'Cached capsuleer record.') {
  return {
    location: { message: 'Unavailable', status: 'unavailable' },
    profile: {
      achievementScore: 0,
      alliance: null,
      bio: { plainText: bio, runs: [{ start: 0, text: bio }] },
      birthday: '2020-01-01T00:00:00.000Z',
      bloodline: 'Deteis',
      corporation: {
        id: 98_000_001,
        memberCount: 1,
        name: 'Persistence Corporation',
        ticker: 'CACHE',
      },
      factionId: null,
      gender: 'Female',
      id: 7,
      name: 'Persistent Pilot',
      race: 'Caldari',
      raceFactionId: null,
      securityStatus: 1,
    },
    ship: { message: 'Unavailable', status: 'unavailable' },
    skills: { message: 'Unavailable', status: 'unavailable' },
  }
}
