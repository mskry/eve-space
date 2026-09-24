// @vitest-environment node

import { createPage, setup, useTestContext } from '@nuxt/test-utils/e2e'
import type { Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cacheAdmissionForCharacter } from '../support/cache-admission'
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
          mainCharacter: { characterId, name: 'Popover Pilot' },
          userId: 'skill-information-e2e-user',
        },
        authenticated: true,
      },
    }
  }
  if (url.pathname === '/api/me/cache-admission') {
    return { body: cacheAdmissionForCharacter('skill-information-e2e-user', characterId) }
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
          ],
          dashboard: [],
        },
      },
    }
  }
  if (url.pathname === '/api/me/characters') {
    return { body: { characters: [ownedCharacter()] } }
  }
  if (url.pathname === `/api/me/characters/${characterId}/skills`) {
    return { body: catalogueSkills() }
  }
  if (url.pathname === `/api/me/characters/${characterId}/attributes`) {
    return {
      body: {
        accruedRemapCooldownDate: null,
        bonusRemaps: 1,
        charisma: 19,
        intelligence: 24,
        lastRemapDate: null,
        memory: 21,
        perception: 27,
        willpower: 22,
      },
    }
  }
  if (url.pathname === `/api/me/characters/${characterId}/skill-queue`) {
    return { body: { activeQueuePosition: null, entries: [], state: 'empty' } }
  }
  const typeMatch = url.pathname.match(/^\/api\/universe\/types\/(\d+)$/)
  if (typeMatch) {
    if (!detailAvailable) {
      return {
        body: { code: 'STATIC_DATA_UNAVAILABLE', message: 'Static data unavailable.' },
        status: 503,
      }
    }
    const typeId = Number(typeMatch[1])
    const name = catalogueSkills().groups[0]!.skills.find((entry) => entry.typeId === typeId)!.name
    return {
      body: {
        category: { id: 16, name: 'Skill' },
        description: longDescription,
        detail: {
          kind: 'skill',
          primaryAttribute: 'perception',
          rank: 3,
          secondaryAttribute: 'willpower',
        },
        group: { id: 255, name: 'Gunnery' },
        name,
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

describe('Skills item-information geometry', async () => {
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
    detailAvailable = true
    requestedPaths.length = 0
    apiServer.setAllowedOrigin(useTestContext().url)
  })

  afterEach(async () => {
    await Promise.all(Array.from(openPages, (page) => page.close()))
    openPages.clear()
  })

  it('adapts catalogue columns without hiding or splitting skill entries', async () => {
    const page = await openPage()
    await page.setViewportSize({ height: 800, width: 1280 })
    await page.locator('.skills-layout').waitFor()

    expect(await measureSkillsLayout(page)).toMatchObject({
      groupBreakInside: 'avoid',
      groupColumns: '3',
      groupVisible: true,
      layoutColumns: 2,
      queueVisible: true,
      skillBreakInside: 'avoid',
      skillColumns: '2',
      skillVisible: true,
      summaryUsesRepeatingGradient: false,
    })

    await page.setViewportSize({ height: 844, width: 760 })
    expect(await measureSkillsLayout(page)).toMatchObject({
      groupColumns: '2',
      groupVisible: true,
      layoutColumns: 1,
      queueBelowCatalogue: true,
      queueVisible: true,
      skillColumns: '1',
      skillVisible: true,
    })

    await page.setViewportSize({ height: 844, width: 520 })
    expect(await measureSkillsLayout(page)).toMatchObject({
      groupColumns: '1',
      groupVisible: true,
      layoutColumns: 1,
      queueBelowCatalogue: true,
      queueVisible: true,
      skillColumns: '1',
      skillVisible: true,
    })
  })

  it('flips a desktop popover into view and keeps close reachable over internal scrolling', async () => {
    const page = await openPage()
    await page.setViewportSize({ height: 720, width: 1024 })
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
    await page.setViewportSize({ height: 844, width: 390 })
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
    alliance: null,
    allianceId: null,
    birthday: '2020-01-01T00:00:00.000Z',
    characterId,
    corporation: { id: 98_000_001, name: 'Popover Geometry' },
    corporationId: 98_000_001,
    isMain: true,
    location: { locationType: 'space', solarSystemId: 30_000_142, solarSystemName: 'Jita' },
    name: 'Popover Pilot',
    raceFactionId: 500_001,
    securityStatus: 1.2,
    ship: { groupId: 29, name: 'Geometry Probe', typeId: 670, typeName: 'Capsule' },
    totalSp: 1_800_000,
    walletBalance: 1_000_000,
  }
}

function catalogueSkills() {
  return {
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
    injectedSkillCount: 4,
    totalSp: 1_800_000,
    unallocatedSp: 0,
  }
}

function skill(typeId: number, name: string) {
  return {
    activeLevel: 4,
    injected: true,
    name,
    skillpoints: 450_000,
    trainedLevel: 4,
    typeId,
  }
}

async function hasHorizontalOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
}

async function measureSkillsLayout(page: Page) {
  return page.evaluate(() => {
    const layout = document.querySelector<HTMLElement>('.skills-layout')
    const catalogue = document.querySelector<HTMLElement>('.skills-catalogue')
    const queue = document.querySelector<HTMLElement>('.skill-queue-rail')
    const groupList = document.querySelector<HTMLElement>('.skill-group-chips')
    const groups = Array.from(document.querySelectorAll<HTMLElement>('.skill-group-chip'))
    const skillList = document.querySelector<HTMLElement>('.skill-list')
    const skillRows = Array.from(document.querySelectorAll<HTMLElement>('.skill-row'))
    const summary = document.querySelector<HTMLElement>('.character-summary-card')
    if (
      !layout ||
      !catalogue ||
      !queue ||
      !groupList ||
      groups.length === 0 ||
      !skillList ||
      skillRows.length === 0 ||
      !summary
    ) {
      throw new Error('Skills layout did not render.')
    }

    const catalogueBox = catalogue.getBoundingClientRect()
    const queueBox = queue.getBoundingClientRect()
    const group = groups[0]!
    const skillRow = skillRows[0]!
    const visibleEntrySets = [groups, skillRows].map((entries) =>
      entries.every((element) => {
        const box = element.getBoundingClientRect()
        return (
          element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
          box.width > 0 &&
          box.height > 0
        )
      }),
    )
    return {
      groupBreakInside: getComputedStyle(group).breakInside,
      groupColumns: getComputedStyle(groupList).columnCount,
      groupVisible: visibleEntrySets[0],
      layoutColumns: getComputedStyle(layout).gridTemplateColumns.split(' ').length,
      queueBelowCatalogue: queueBox.top >= catalogueBox.bottom,
      queueVisible: getComputedStyle(queue).display !== 'none' && queueBox.height > 0,
      skillBreakInside: getComputedStyle(skillRow).breakInside,
      skillColumns: getComputedStyle(skillList).columnCount,
      skillVisible: visibleEntrySets[1],
      summaryUsesRepeatingGradient: getComputedStyle(summary).backgroundImage.includes(
        'repeating-linear-gradient',
      ),
    }
  })
}
