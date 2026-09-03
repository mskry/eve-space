// @vitest-environment node

import { $fetch, createPage, setup, useTestContext } from '@nuxt/test-utils/e2e'
import type { Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startCorsJsonApi } from '../support/cors-json-api'

type ApiMode = 'data' | 'implants-scope-required' | 'long-content'

const characterId = 7
const recordedPaths: string[] = []
const longValue = 'LONG-CLONE-IDENTITY-'.repeat(18)
let apiMode: ApiMode = 'data'
let apiOrigin = ''

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
          userId: 'clones-e2e-user',
          mainCharacter: { characterId, name: 'Clone Pilot' },
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
            { ownerId: 'core', navigationId: 'core-character-history' },
            { ownerId: 'core', navigationId: 'core-character-mail' },
          ],
        },
      },
    }
  }
  if (url.pathname === '/api/me/characters') return { body: { characters: [ownedCharacter()] } }
  if (url.pathname === `/api/me/characters/${characterId}`) {
    return {
      body: {
        profile: {
          id: characterId,
          name: 'Clone Pilot',
          birthday: '2020-01-01T00:00:00.000Z',
          gender: 'Female',
          race: 'Caldari',
          raceFactionId: null,
          bloodline: 'Deteis',
          securityStatus: 1,
          achievementScore: 0,
          factionId: null,
          corporation: { id: 98_000_001, name: 'Clone Research', ticker: 'CLONE', memberCount: 8 },
          alliance: null,
        },
        location: { status: 'unavailable', message: 'Unavailable' },
        ship: { status: 'unavailable', message: 'Unavailable' },
        skills: { status: 'unavailable', message: 'Unavailable' },
      },
    }
  }
  if (url.pathname === `/api/me/characters/${characterId}/clones`) {
    return { body: cloneState() }
  }
  if (url.pathname === `/api/me/characters/${characterId}/implants`) {
    if (apiMode === 'implants-scope-required') {
      return {
        status: 403,
        body: {
          code: 'EVE_SCOPE_REQUIRED',
          message: 'Authorize implant access for this character.',
          requiredScope: 'esi-clones.read_implants.v1',
          authorizeUrl: `${apiOrigin}/auth/eve/reauthorize/${characterId}?returnTo=%2Fcharacters%2F${characterId}%2Fclones`,
        },
      }
    }
    return { body: activeImplants() }
  }
  const typeMatch = url.pathname.match(/^\/api\/universe\/types\/(\d+)$/)
  if (typeMatch) {
    const typeId = Number(typeMatch[1])
    return {
      body: {
        typeId,
        name: implantName(typeId),
        description: 'Public implant details without character placement.',
        group: { id: 300, name: 'Cyberimplant' },
        category: { id: 20, name: 'Implant' },
        detail: {
          kind: 'implant',
          slot: typeId === 2 ? 1 : 2,
          bonuses: [{ attribute: 'memory', value: 3 }],
        },
      },
    }
  }

  return { status: 404, body: { code: 'NOT_FOUND', message: 'Not found.' } }
})

apiOrigin = apiServer.origin
process.env.NUXT_PUBLIC_API_BASE = apiOrigin
process.env.NUXT_PUBLIC_EVE_IMAGE_BASE = apiOrigin

afterAll(apiServer.close)

describe('character Clones production route', async () => {
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
    expect(cloneResourcePaths()).toEqual([])
    expect(recordedPaths.some((path) => path.includes('/fatigue'))).toBe(false)
  })

  it('prefetches both resources on pointer and focus intent and reuses them on navigation', async () => {
    for (const intent of ['hover', 'focus'] as const) {
      recordedPaths.length = 0
      const page = await openPage(`/characters/${characterId}`)
      const navigation = page.getByRole('navigation', { name: 'Character record sections' })
      const clonesLink = navigation.getByRole('link', { name: 'CLONES', exact: true })
      await clonesLink.waitFor()

      if (intent === 'hover') await clonesLink.hover()
      else await clonesLink.focus()
      await expect.poll(() => cloneResourcePaths().toSorted()).toEqual(clonePaths().toSorted())

      const requestsAfterIntent = cloneResourcePaths().length
      await clonesLink.click()
      await page.locator('.character-clones-workspace').waitFor()
      await page.getByRole('region', { name: 'Active clone', exact: true }).waitFor()
      await page.getByRole('region', { name: 'Home location', exact: true }).waitFor()
      await page.getByRole('region', { name: 'Jump clones by location', exact: true }).waitFor()
      expect(cloneResourcePaths()).toHaveLength(requestsAfterIntent)
      expect(await clonesLink.getAttribute('aria-current')).toBe('page')
      expect(await navigation.getByRole('link').allTextContents()).toEqual([
        'OVERVIEW',
        'SKILLS',
        'CLONES',
        'FINANCE',
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

    await page.getByRole('heading', { name: 'Jump clones by location' }).waitFor()
    await page.getByRole('heading', { name: 'Active implant authorization required' }).waitFor()
    expect(await page.getByText('Industry clone', { exact: true }).isVisible()).toBe(true)
    expect(
      await page.getByRole('link', { name: 'AUTHORIZE THIS CHARACTER' }).getAttribute('href'),
    ).toContain(`returnTo=%2Fcharacters%2F${characterId}%2Fclones`)
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
    await page.setViewportSize({ width: 1180, height: 820 })
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

    const disclosure = cards.first().locator('.character-clones-card-summary')
    const cloneName = cards.first().locator('.character-clones-card-name')
    const previewIcon = cards.first().locator('.character-clones-card-preview-item').first()
    const previewStyle = await previewIcon.locator('.ui-eve-image').evaluate((element) => {
      const style = getComputedStyle(element)
      return { width: style.width, height: style.height, opacity: style.opacity }
    })
    expect(previewStyle).toEqual({ width: '20px', height: '20px', opacity: '0.38' })
    const disclosureBefore = await disclosure.boundingBox()
    const cloneNameBefore = await cloneName.boundingBox()
    expect(await disclosure.getAttribute('aria-expanded')).toBe('false')
    await disclosure.focus()
    await page.keyboard.press('Enter')
    expect(await disclosure.getAttribute('aria-expanded')).toBe('true')
    expect(
      await cards
        .first()
        .locator('.character-clones-card-preview')
        .evaluate((element) => getComputedStyle(element).visibility),
    ).toBe('hidden')
    const disclosureAfter = await disclosure.boundingBox()
    const cloneNameAfter = await cloneName.boundingBox()
    expect(cloneNameAfter!.y - disclosureAfter!.y).toBe(cloneNameBefore!.y - disclosureBefore!.y)

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

    await page.setViewportSize({ width: 390, height: 844 })
    const mobileFirstBox = await cards.nth(0).boundingBox()
    const mobileSecondBox = await cards.nth(1).boundingBox()
    expect(mobileFirstBox).not.toBeNull()
    expect(mobileSecondBox).not.toBeNull()
    expect(mobileSecondBox!.y).toBeGreaterThan(mobileFirstBox!.y + mobileFirstBox!.height - 1)
    expect(await hasHorizontalOverflow(page)).toBe(false)

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
    characterId,
    name: 'Clone Pilot',
    corporationId: 98_000_001,
    allianceId: null,
    isMain: true,
    birthday: '2020-01-01T00:00:00.000Z',
    securityStatus: 1,
    raceFactionId: 500_001,
    location: { solarSystemId: 30_000_142, solarSystemName: 'Jita' },
    ship: { typeId: 670, typeName: 'Capsule', name: 'Clone Capsule' },
    walletBalance: 1_000_000,
    totalSp: 1_800_000,
    corporation: { id: 98_000_001, name: 'Clone Research' },
    alliance: null,
  }
}

function cloneState() {
  const name = apiMode === 'long-content' ? longValue : 'Industry clone'
  const locationName = apiMode === 'long-content' ? longValue : 'Jita IV - Moon 4'
  return {
    homeLocation: { locationId: 60_000_001, locationType: 'station', name: locationName },
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
        implants: [implantSummary(3)],
      },
    ],
    lastCloneJumpAt: '2026-09-02T12:00:00Z',
    lastStationChangeAt: '2026-08-30T12:00:00Z',
    cachedUntil: '2026-09-03T11:02:00.000Z',
    validatedAt: '2026-09-03T11:00:00.000Z',
    stale: false,
  }
}

function activeImplants() {
  return {
    implants: [implantSummary(2)],
    cachedUntil: '2026-09-03T11:02:00.000Z',
    validatedAt: '2026-09-03T11:00:00.000Z',
    stale: false,
  }
}

function implantSummary(typeId: number) {
  return {
    typeId,
    name: implantName(typeId),
    slot: typeId === 2 ? 1 : 2,
    bonuses: [{ attribute: 'memory', value: 3 }],
  }
}

function implantName(typeId: number) {
  if (apiMode === 'long-content') return `${longValue}${typeId}`
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
