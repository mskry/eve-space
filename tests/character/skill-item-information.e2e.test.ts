// @vitest-environment node

import { createPage, setup, useTestContext } from '@nuxt/test-utils/e2e'
import type { Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startCorsJsonApi } from '../support/cors-json-api'

const characterId = 7
const longDescription = Array.from(
  { length: 28 },
  (_, index) =>
    `Section ${index + 1}. Tracking systems compensate for angular motion while preserving precise firing solutions.`,
).join('\n\n')
const requestedPaths: string[] = []
let apiOrigin = ''
let detailAvailable = true

const apiServer = await startCorsJsonApi((request) => {
  const url = new URL(request.url ?? '/', 'http://mock-api.invalid')
  requestedPaths.push(url.pathname)

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
          userId: 'skill-information-e2e-user',
          mainCharacter: { characterId, name: 'Popover Pilot' },
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
          ],
        },
      },
    }
  }
  if (url.pathname === '/api/me/characters') return { body: { characters: [ownedCharacter()] } }
  if (url.pathname === `/api/me/characters/${characterId}/skills`) {
    return { body: catalogueSkills() }
  }
  if (url.pathname === `/api/me/characters/${characterId}/attributes`) {
    return {
      body: {
        charisma: 19,
        intelligence: 24,
        memory: 21,
        perception: 27,
        willpower: 22,
        bonusRemaps: 1,
        accruedRemapCooldownDate: null,
        lastRemapDate: null,
      },
    }
  }
  if (url.pathname === `/api/me/characters/${characterId}/skill-queue`) {
    return { body: { state: 'empty', activeQueuePosition: null, entries: [] } }
  }
  const typeMatch = url.pathname.match(/^\/api\/universe\/types\/(\d+)$/)
  if (typeMatch) {
    if (!detailAvailable) {
      return {
        status: 503,
        body: { code: 'STATIC_DATA_UNAVAILABLE', message: 'Static data unavailable.' },
      }
    }
    const typeId = Number(typeMatch[1])
    const name = catalogueSkills().groups[0]!.skills.find((entry) => entry.typeId === typeId)!.name
    return {
      body: {
        typeId,
        name,
        description: longDescription,
        group: { id: 255, name: 'Gunnery' },
        category: { id: 16, name: 'Skill' },
        detail: {
          kind: 'skill',
          rank: 3,
          primaryAttribute: 'perception',
          secondaryAttribute: 'willpower',
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

describe('Skills item-information geometry', async () => {
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
    detailAvailable = true
    requestedPaths.length = 0
    apiServer.setAllowedOrigin(useTestContext().url)
  })

  afterEach(async () => {
    await Promise.all(Array.from(openPages, (page) => page.close()))
    openPages.clear()
  })

  it('flips a desktop popover into view and keeps close reachable over internal scrolling', async () => {
    const page = await openPage()
    await page.setViewportSize({ width: 1024, height: 720 })
    const trigger = page.getByRole('button', {
      name: 'View item information for Surgical Strike',
    })
    await trigger.waitFor()
    await trigger.evaluate((element) => element.scrollIntoView({ block: 'end' }))
    await trigger.focus()
    await page.keyboard.press('Enter')

    const dialog = page.getByRole('dialog')
    await dialog.getByRole('heading', { name: 'Surgical Strike' }).waitFor()
    await expect.poll(() => dialog.getAttribute('data-side')).toBe('top')
    await expect
      .poll(async () => {
        const [dialogBox, triggerBox] = await Promise.all([
          dialog.boundingBox(),
          trigger.boundingBox(),
        ])
        return Boolean(
          dialogBox && triggerBox && dialogBox.y + dialogBox.height <= triggerBox.y + 1,
        )
      })
      .toBe(true)

    const dialogBox = await dialog.boundingBox()
    const triggerBox = await trigger.boundingBox()
    expect(dialogBox).not.toBeNull()
    expect(triggerBox).not.toBeNull()
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0)
    expect(dialogBox!.y).toBeGreaterThanOrEqual(0)
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(triggerBox!.y + 1)
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(720)

    const scroller = dialog.locator('.eve-item-information-popover-scroll')
    expect(await scroller.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true,
    )
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    const close = dialog.getByRole('button', { name: 'Close item information' })
    expect(await close.isVisible()).toBe(true)
    expect(await hasHorizontalOverflow(page)).toBe(false)

    await close.click()
    expect(await trigger.evaluate((element) => document.activeElement === element)).toBe(true)
  })

  it('keeps retry and long item content reachable within a mobile viewport', async () => {
    detailAvailable = false
    const page = await openPage()
    await page.setViewportSize({ width: 390, height: 844 })
    const trigger = page.getByRole('button', {
      name: 'View item information for Motion Prediction',
    })
    await trigger.waitFor()
    await trigger.click()

    const dialog = page.getByRole('dialog')
    const retry = dialog.getByRole('button', { name: 'RETRY UPLINK' })
    await retry.waitFor({ state: 'visible' })
    expect(await retry.isVisible()).toBe(true)

    detailAvailable = true
    await retry.click()
    await dialog.getByRole('heading', { name: 'Motion Prediction' }).waitFor()

    const dialogBox = await dialog.boundingBox()
    expect(dialogBox).not.toBeNull()
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0)
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(390)
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(844)
    expect(
      await dialog
        .locator('.eve-item-information-popover-scroll')
        .evaluate((element) => element.scrollHeight > element.clientHeight),
    ).toBe(true)
    expect(await hasHorizontalOverflow(page)).toBe(false)
    expect(
      requestedPaths.filter((path) => path === '/api/universe/types/100').length,
    ).toBeGreaterThan(1)
  })

  async function openPage() {
    const page = await createPage(`/characters/${characterId}/skills`)
    openPages.add(page)
    return page
  }
})

function ownedCharacter() {
  return {
    characterId,
    name: 'Popover Pilot',
    corporationId: 98_000_001,
    allianceId: null,
    isMain: true,
    birthday: '2020-01-01T00:00:00.000Z',
    securityStatus: 1.2,
    raceFactionId: 500_001,
    location: { solarSystemId: 30_000_142, solarSystemName: 'Jita' },
    ship: { typeId: 670, typeName: 'Capsule', name: 'Geometry Probe' },
    walletBalance: 1_000_000,
    totalSp: 1_800_000,
    corporation: { id: 98_000_001, name: 'Popover Geometry' },
    alliance: null,
  }
}

function catalogueSkills() {
  return {
    totalSp: 1_800_000,
    unallocatedSp: 0,
    injectedSkillCount: 4,
    groups: [
      {
        groupId: 255,
        name: 'Gunnery',
        trainedSp: 1_800_000,
        skills: [
          skill(100, 'Motion Prediction'),
          skill(101, 'Sharpshooter'),
          skill(102, 'Trajectory Analysis'),
          skill(103, 'Surgical Strike'),
        ],
      },
    ],
  }
}

function skill(typeId: number, name: string) {
  return {
    typeId,
    name,
    injected: true,
    activeLevel: 4,
    trainedLevel: 4,
    skillpoints: 450_000,
  }
}

async function hasHorizontalOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
}
