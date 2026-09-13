// @vitest-environment node

import { $fetch, createPage, setup, useTestContext } from '@nuxt/test-utils/e2e'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { startCorsJsonApi } from '../support/cors-json-api'

let apiAvailable = false
const apiServer = await startCorsJsonApi((request) => {
  if (apiAvailable) {
    if (request.url === '/auth/session')
      return {
        body: {
          authenticated: true,
          account: { userId: 'test-user', mainCharacter: { characterId: 7, name: 'Test Pilot' } },
        },
      }
    else if (request.url === '/auth/config')
      return { body: { configured: false, loginUrl: '', attachUrl: '' } }
    else if (request.url === '/api/admin/session') return { body: { authenticated: false } }
    else if (request.url === '/api/me/characters') return { body: { characters: [] } }
    else if (request.url === '/api/status')
      return {
        body: {
          status: 'operational',
          checkedAt: '2026-09-03T11:00:00.000Z',
          cachedUntil: '2026-09-03T11:00:15.000Z',
          services: {
            api: { status: 'operational', uptimeSeconds: 100 },
            database: { status: 'operational', latencyMs: 1 },
            esi: {
              status: 'operational',
              latencyMs: 2,
              checkedAt: '2026-09-03T11:00:00.000Z',
              players: 20_000,
              serverVersion: 'test',
              startedAt: null,
              vip: false,
              errorBudgetRemaining: 100,
              errorBudgetResetSeconds: 10,
            },
          },
        },
      }
    else if (request.url === '/api/modules')
      return {
        body: {
          enabledModuleIds: [],
          shellNavigationOrder: { dashboard: [], character: [] },
        },
      }
    return { body: { code: 'NOT_FOUND', message: 'Not found.' } }
  }
  return {
    status: 403,
    body: { code: 'TEST_FAILURE', message: 'API unavailable for SSR test.' },
  }
})
process.env.NUXT_PUBLIC_API_BASE = apiServer.origin

afterAll(apiServer.close)

describe('Nuxt anonymous SSR boundary', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('..', import.meta.url)),
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

  it('renders a neutral session state instead of anonymous dashboard content', async () => {
    const html = await $fetch('/')

    expect(html).toContain('Verifying account identity...')
    expect(html).not.toContain('Command overview')
    expect(html).toContain('data-ssr="true"')
    expect(html).toContain('ApiQueryError')
  })

  it('keeps dashboard navigation keyboard accessible on mobile', async () => {
    apiAvailable = true
    apiServer.setAllowedOrigin(useTestContext().url)
    const page = await createPage('/')
    await page.setViewportSize({ width: 390, height: 844 })

    const persistentSidebar = page.locator('.dashboard-sidebar--persistent')
    const trigger = page.getByRole('button', { name: 'Open navigation' })
    expect(await page.content()).toContain('dashboard-shell')
    expect(await persistentSidebar.isHidden()).toBe(true)
    expect(await trigger.isVisible()).toBe(true)

    await trigger.focus()
    await page.keyboard.press('Enter')
    expect(await page.getByRole('button', { name: 'Close navigation' }).isVisible()).toBe(true)
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
    apiServer.setAllowedOrigin(useTestContext().url)
    const page = await createPage('/')
    await page.setViewportSize({ width: 390, height: 844 })
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
    apiServer.setAllowedOrigin(useTestContext().url)
    const page = await createPage('/')
    await page.setViewportSize({ width: 1280, height: 800 })

    expect(await page.content()).toContain('dashboard-shell')
    expect(await page.locator('.auth-shell').count()).toBe(0)
    expect(await page.locator('.dashboard-sidebar--persistent').isVisible()).toBe(true)
    expect(await page.getByRole('button', { name: 'Open navigation' }).isHidden()).toBe(true)
  })

  it('keeps theme text and focus indicators at accessible contrast', async () => {
    apiAvailable = true
    apiServer.setAllowedOrigin(useTestContext().url)
    const page = await createPage('/')
    const themes = ['gallente', 'high-sec', 'amarr', 'minmatar', 'caldari']
    const textTokens = [
      '--ui-text',
      '--ui-text-muted',
      '--ui-text-subtle',
      '--ui-text-faint',
      '--ui-primary',
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
    apiServer.setAllowedOrigin(useTestContext().url)
    const page = await createPage('/admin/login')
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
    ).toEqual({ outlineStyle: 'solid', outlineWidth: '2px' })

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
    await expect
      .poll(() =>
        page.locator('#main-content').evaluate((element) => document.activeElement === element),
      )
      .toBe(true)
    await expect.poll(() => page.title()).toBe('Overview // EVE Space')
    await expect
      .poll(() => page.locator('.nuxt-route-announcer [role="status"]').textContent())
      .toBe('Overview // EVE Space')

    await page.goto(new URL('/characters', useTestContext().url).toString())
    expect(await page.locator('main').count()).toBe(1)
    expect(await page.locator('#main-content').getAttribute('tabindex')).toBe('-1')
  })
})

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
  if (channels?.length === 3) return [...channels, 1] as Color
  if (channels?.length === 4) return channels as Color
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
