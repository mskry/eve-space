// @vitest-environment node

import { $fetch, createPage, setup } from '@nuxt/test-utils/e2e'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

let apiAvailable = false
const apiServer = createServer((request, response) => {
  if (apiAvailable) {
    const headers = {
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Origin': request.headers.origin ?? '*',
      'Content-Type': 'application/json',
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, headers)
      response.end()
      return
    }
    response.writeHead(200, headers)
    if (request.url === '/auth/session')
      response.end(
        JSON.stringify({
          authenticated: true,
          account: { userId: 'test-user', mainCharacter: { characterId: 7, name: 'Test Pilot' } },
        }),
      )
    else if (request.url === '/auth/config')
      response.end(JSON.stringify({ configured: false, loginUrl: '', attachUrl: '' }))
    else if (request.url === '/api/admin/session')
      response.end(JSON.stringify({ authenticated: false }))
    else if (request.url === '/api/modules')
      response.end(
        JSON.stringify({
          enabledModuleIds: [],
          shellNavigationOrder: { dashboard: [], character: [] },
        }),
      )
    else response.end(JSON.stringify({ code: 'NOT_FOUND', message: 'Not found.' }))
    return
  }
  response.writeHead(403, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ code: 'TEST_FAILURE', message: 'API unavailable for SSR test.' }))
})
await new Promise<void>((resolve) => apiServer.listen(0, '127.0.0.1', resolve))
const apiAddress = apiServer.address() as AddressInfo
process.env.NUXT_PUBLIC_API_BASE = `http://127.0.0.1:${apiAddress.port}`

afterAll(() => new Promise<void>((resolve) => apiServer.close(() => resolve())))

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
    const page = await createPage('/')
    await page.setViewportSize({ width: 1280, height: 800 })

    expect(await page.content()).toContain('dashboard-shell')
    expect(await page.locator('.dashboard-sidebar--persistent').isVisible()).toBe(true)
    expect(await page.getByRole('button', { name: 'Open navigation' }).isHidden()).toBe(true)
  })
})
