// @vitest-environment node

import { $fetch, createPage, setup, useTestContext } from '@nuxt/test-utils/e2e'
import type { Locator, Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cacheAdmissionForCharacter } from '../support/cache-admission'
import { startCorsJsonApi } from '../support/cors-json-api'

type ApiMode = 'data' | 'implants-scope-required' | 'long-content'

const characterId = 7
const recordedPaths: string[] = []
const longValue = 'LONG-CLONE-IDENTITY-'.repeat(18)
let apiMode: ApiMode = 'data'
let apiOrigin = ''

const sessionResponse = (includeAdmission: boolean) => ({
  account: {
    mainCharacter: { characterId, name: 'Clone Pilot' },
    userId: 'clones-e2e-user',
  },
  authenticated: true,
  ...(includeAdmission && {
    cacheAdmission: cacheAdmissionForCharacter('clones-e2e-user', characterId),
  }),
})

const apiServer = await startCorsJsonApi((request) => {
  const url = new URL(request.url ?? '/', 'http://mock-api.invalid')
  recordedPaths.push(url.pathname)

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
    return { body: sessionResponse(url.searchParams.get('includeAdmission') === 'true') }
  }
  if (url.pathname === '/api/me/cache-admission') {
    return { body: cacheAdmissionForCharacter('clones-e2e-user', characterId) }
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
            { ownerId: 'core', navigationId: 'core-character-clones' },
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
  if (url.pathname === `/api/me/characters/${characterId}`) {
    return {
      body: {
        location: { message: 'Unavailable', status: 'unavailable' },
        profile: {
          achievementScore: 0,
          alliance: null,
          birthday: '2020-01-01T00:00:00.000Z',
          bloodline: 'Deteis',
          corporation: { id: 98_000_001, memberCount: 8, name: 'Clone Research', ticker: 'CLONE' },
          factionId: null,
          gender: 'Female',
          id: characterId,
          name: 'Clone Pilot',
          race: 'Caldari',
          raceFactionId: null,
          securityStatus: 1,
        },
        ship: { message: 'Unavailable', status: 'unavailable' },
        skills: { message: 'Unavailable', status: 'unavailable' },
      },
    }
  }
  if (url.pathname === `/api/me/characters/${characterId}/clones`) {
    return { body: cloneState() }
  }
  if (url.pathname === `/api/me/characters/${characterId}/implants`) {
    if (apiMode === 'implants-scope-required') {
      return {
        body: {
          authorizeUrl: `${apiOrigin}/auth/eve/reauthorize/${characterId}?returnTo=%2Fcharacters%2F${characterId}%2Fclones`,
          code: 'EVE_SCOPE_REQUIRED',
          message: 'Authorize implant access for this character.',
          requiredScope: 'esi-clones.read_implants.v1',
        },
        status: 403,
      }
    }
    return { body: activeImplants() }
  }
  const typeMatch = url.pathname.match(/^\/api\/universe\/types\/(\d+)$/)
  if (typeMatch) {
    const typeId = Number(typeMatch[1])
    return {
      body: {
        category: { id: 20, name: 'Implant' },
        description: 'Public implant details without character placement.',
        detail: {
          bonuses: [{ attribute: 'memory', value: 3 }],
          kind: 'implant',
          slot: typeId === 2 ? 1 : 2,
        },
        group: { id: 300, name: 'Cyberimplant' },
        name: implantName(typeId),
        typeId,
      },
    }
  }

  return { body: { code: 'NOT_FOUND', message: 'Not found.' }, status: 404 }
})

apiOrigin = apiServer.origin
process.env.NUXT_PUBLIC_API_BASE = apiOrigin
process.env.NUXT_PUBLIC_EVE_IMAGE_BASE = apiOrigin

afterAll(apiServer.close)

describe('character Clones production route', async () => {
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
    recordedPaths.length = 0
    apiServer.setAllowedOrigin(useTestContext().url)
  })

  afterEach(async () => {
    await Promise.all(Array.from(openPages, (page) => page.close()))
    openPages.clear()
  })

  it('keeps protected clone resources out of direct-route SSR', async () => {
    const html = await $fetch(`/characters/${characterId}/clones`)

    expect(html).toContain('Verifying account identity...')
    expect(cloneResourcePaths()).toStrictEqual([])
    expect(recordedPaths.some((path) => path.includes('/fatigue'))).toBe(false)
  })

  it('prefetches both resources on pointer and focus intent and reuses them on navigation', async () => {
    for (const intent of ['hover', 'focus'] as const) {
      recordedPaths.length = 0
      const page = await openPage(`/characters/${characterId}`)
      const navigation = page.getByRole('navigation', { name: 'Character record sections' })
      const clonesLink = navigation.getByRole('link', { exact: true, name: 'CLONES' })
      await clonesLink.waitFor()

      if (intent === 'hover') {
        await clonesLink.hover()
      } else {
        await clonesLink.focus()
      }
      await expect
        .poll(() => cloneResourcePaths().toSorted((left, right) => left.localeCompare(right)))
        .toEqual(clonePaths().toSorted((left, right) => left.localeCompare(right)))

      const requestsAfterIntent = cloneResourcePaths().length
      await clonesLink.click()
      await page.locator('.character-clones-workspace').waitFor()
      const summary = page.getByRole('region', { exact: true, name: 'Jump clones' })
      await summary.waitFor()
      await summary.getByText('HOME STATION', { exact: true }).waitFor()
      await page.getByRole('region', { exact: true, name: 'Jump clones by location' }).waitFor()
      expect(cloneResourcePaths()).toHaveLength(requestsAfterIntent)
      expect(await clonesLink.getAttribute('aria-current')).toBe('page')
      expect(await navigation.getByRole('link').allTextContents()).toStrictEqual([
        'OVERVIEW',
        'SKILLS',
        'CLONES',
        'FINANCE',
        'ASSETS',
        'HISTORY',
        'MAIL',
      ])
      await page.close()
      openPages.delete(page)
    }
  })

  it('keeps clone state visible when active implants require authorization', async () => {
    apiMode = 'implants-scope-required'
    const page = await openPage(`/characters/${characterId}/clones`)

    const storedClones = page.getByRole('region', {
      exact: true,
      name: 'Jump clones by location',
    })
    await storedClones.waitFor()
    expect(recordedPaths).toContain(clonePaths()[0])
    expect(recordedPaths).not.toContain('/api/me/cache-admission')
    await storedClones.getByRole('button').click()
    await page.getByRole('heading', { name: 'Active implant authorization required' }).waitFor()
    expect(await page.getByText('Industry clone', { exact: true }).isVisible()).toBe(true)
    const authorizationState = page.locator('.character-clones-rack .esi-authorization-required')
    const authorizationLink = authorizationState.getByRole('link', {
      name: 'AUTHORIZE THIS CHARACTER',
    })
    const authorizationStateBox = await authorizationState.boundingBox()
    const authorizationLinkBox = await authorizationLink.boundingBox()
    expect(authorizationStateBox).not.toBeNull()
    expect(authorizationLinkBox).not.toBeNull()
    expect(authorizationStateBox!.height).toBeLessThan(128)
    expect(authorizationLinkBox!.width).toBeLessThan(authorizationStateBox!.width)
    expect(await authorizationLink.getAttribute('href')).toContain(
      `returnTo=%2Fcharacters%2F${characterId}%2Fclones`,
    )
  })

  it('refreshes both resources after exact-character reauthorization', async () => {
    const page = await openPage(`/characters/${characterId}/clones`)
    await page.locator('.character-clones-workspace').waitFor()
    const cloneRequestsBefore = cloneResourcePaths().filter(
      (path) => path === clonePaths()[0],
    ).length
    const implantRequestsBefore = cloneResourcePaths().filter(
      (path) => path === clonePaths()[1],
    ).length

    await page.evaluate(() => {
      history.pushState({}, '', `${location.pathname}?reauthorize=success`)
      dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
    })

    await page.getByText('Character authorization refreshed.', { exact: true }).waitFor()
    await expect
      .poll(() => cloneResourcePaths().filter((path) => path === clonePaths()[0]).length)
      .toBeGreaterThan(cloneRequestsBefore)
    await expect
      .poll(() => cloneResourcePaths().filter((path) => path === clonePaths()[1]).length)
      .toBeGreaterThan(implantRequestsBefore)
    await expect.poll(() => new URL(page.url()).searchParams.has('reauthorize')).toBe(false)
  })

  it('contains long cards and implant popovers on desktop and mobile without overflow', async () => {
    apiMode = 'long-content'
    const page = await openPage(`/characters/${characterId}/clones`)
    await page.setViewportSize({ height: 820, width: 1180 })
    const storedClones = page.getByRole('region', {
      exact: true,
      name: 'Jump clones by location',
    })
    await storedClones.getByRole('button').click()
    const cards = page.locator('.character-clones-card')
    await cards.first().waitFor()

    const activeCloneBox = await page.locator('.character-clones-active').boundingBox()
    const augmentationsBox = await page.locator('.character-clones-rack').boundingBox()
    expect(activeCloneBox).not.toBeNull()
    expect(augmentationsBox).not.toBeNull()
    expect(Math.round(augmentationsBox!.y - activeCloneBox!.y - activeCloneBox!.height)).toBe(22)

    expect(await page.locator('.character-clones-group').count()).toBe(2)
    const firstBox = await cards.nth(0).boundingBox()
    const secondBox = await cards.nth(1).boundingBox()
    expect(firstBox).not.toBeNull()
    expect(secondBox).not.toBeNull()
    expect(secondBox!.y).toBeGreaterThan(firstBox!.y + firstBox!.height - 1)
    expect(await hasHorizontalOverflow(page)).toBe(false)

    expect(await cards.first().locator('.character-clones-implant-name').count()).toBe(1)
    const emptyCard = cards.nth(1)
    expect(
      await emptyCard.evaluate((element) =>
        element.classList.contains('character-clones-card--empty'),
      ),
    ).toBe(true)
    expect(await emptyCard.locator('.character-clones-empty-implants').isVisible()).toBe(true)

    const trigger = cards.first().getByRole('button', {
      name: `View item information for ${implantName(2)}`,
    })
    await trigger.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('heading', { name: implantName(2) }).waitFor()
    const desktopDialogBox = await dialog.boundingBox()
    expectWithinViewport(desktopDialogBox, 1180, 820)
    await dialog.getByRole('button', { name: 'Close item information' }).click()
    expect(await trigger.evaluate((element) => document.activeElement === element)).toBe(true)

    // The route clips overflow, so document width stays clean while a card overflows inside it.
    for (const width of [430, 390, 320]) {
      await page.setViewportSize({ height: 844, width })
      await expect.poll(() => cardsOverflowing(cards)).toEqual([])
      expect(await hasHorizontalOverflow(page)).toBe(false)
    }

    await expect
      .poll(() =>
        cards.evaluateAll((elements) => {
          const first = elements[0]?.getBoundingClientRect()
          const second = elements[1]?.getBoundingClientRect()
          if (!first || !second) {
            return Number.NEGATIVE_INFINITY
          }
          return second.y - first.bottom
        }),
      )
      .toBeGreaterThan(-1)

    await trigger.click()
    await dialog.getByRole('heading', { name: implantName(2) }).waitFor()
    expectWithinViewport(await dialog.boundingBox(), 390, 844)
    expect(await hasHorizontalOverflow(page)).toBe(false)
  })

  async function openPage(path: string) {
    const page = await createPage(path)
    openPages.add(page)
    return page
  }
})

function ownedCharacter() {
  return {
    alliance: null,
    allianceId: null,
    birthday: '2020-01-01T00:00:00.000Z',
    characterId,
    corporation: { id: 98_000_001, name: 'Clone Research' },
    corporationId: 98_000_001,
    isMain: true,
    location: { locationType: 'space', solarSystemId: 30_000_142, solarSystemName: 'Jita' },
    name: 'Clone Pilot',
    raceFactionId: 500_001,
    securityStatus: 1,
    ship: { groupId: 29, name: 'Clone Capsule', typeId: 670, typeName: 'Capsule' },
    totalSp: 1_800_000,
    walletBalance: 1_000_000,
  }
}

function cloneState() {
  const name = apiMode === 'long-content' ? longValue : 'Industry clone'
  const locationName = apiMode === 'long-content' ? longValue : 'Jita IV - Moon 4'
  return {
    cachedUntil: '2026-09-03T11:02:00.000Z',
    homeLocation: {
      locationId: 60_000_001,
      locationType: 'station',
      name: locationName,
      solarSystemSecurityStatus: 0.9,
    },
    jumpClones: [
      {
        jumpCloneId: 11,
        name,
        location: { locationId: 60_000_001, locationType: 'station', name: locationName },
        implants: [implantSummary(2)],
      },
      {
        jumpCloneId: 12,
        name: null,
        location: { locationId: 1_035_466_617_946, locationType: 'structure', name: null },
        implants: [],
      },
    ],
    lastCloneJumpAt: '2026-09-02T12:00:00Z',
    lastStationChangeAt: '2026-08-30T12:00:00Z',
    stale: false,
    validatedAt: '2026-09-03T11:00:00.000Z',
  }
}

function activeImplants() {
  return {
    cachedUntil: '2026-09-03T11:02:00.000Z',
    implants: [implantSummary(2)],
    stale: false,
    validatedAt: '2026-09-03T11:00:00.000Z',
  }
}

function implantSummary(typeId: number) {
  return {
    bonuses: [{ attribute: 'memory', value: 3 }],
    name: implantName(typeId),
    slot: typeId === 2 ? 1 : 2,
    typeId,
  }
}

function implantName(typeId: number) {
  if (apiMode === 'long-content') {
    return `${longValue}${typeId}`
  }
  return typeId === 2 ? 'Memory Augmentation' : 'Ocular Filter'
}

function clonePaths() {
  return [`/api/me/characters/${characterId}/clones`, `/api/me/characters/${characterId}/implants`]
}

function cloneResourcePaths() {
  return recordedPaths.filter((path) => clonePaths().includes(path))
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

function hasHorizontalOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
}

// Names the cards whose content is wider than they are, which the clipped route hides.
function cardsOverflowing(cards: Locator) {
  return cards.evaluateAll((elements) =>
    elements
      .map((element, index) => ({ index, overflow: element.scrollWidth - element.clientWidth }))
      .filter((entry) => entry.overflow > 1)
      .map((entry) => entry.index),
  )
}
