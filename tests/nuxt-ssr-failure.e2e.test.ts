// @vitest-environment node

import { $fetch, createPage, setup, useTestContext } from '@nuxt/test-utils/e2e'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { startCorsJsonApi } from './support/cors-json-api'

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
          dir: fileURLToPath(new URL('../.output', import.meta.url)),
        },
      },
    },
    browser: true,
    server: true,
    captureServerLogs: false,
    setupTimeout: 120_000,
  })

  it('renders the authorization route instead of anonymous dashboard content', async () => {
    const html = await $fetch('/')

    expect(html).toContain('Authorize your capsuleer')
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

  it('uses persistent navigation on the supported desktop layout', async () => {
    apiServer.setAllowedOrigin(useTestContext().url)
    const page = await createPage('/')
    await page.setViewportSize({ width: 1280, height: 800 })

    expect(await page.content()).toContain('dashboard-shell')
    expect(await page.locator('.dashboard-sidebar--persistent').isVisible()).toBe(true)
    expect(await page.getByRole('button', { name: 'Open navigation' }).isHidden()).toBe(true)
  })
})
