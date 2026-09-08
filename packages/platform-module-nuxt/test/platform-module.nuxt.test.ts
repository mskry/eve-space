import { $fetch, createPage, setup, useTestContext } from '@nuxt/test-utils/e2e'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { startCorsJsonApi } from '../../../tests/support/cors-json-api'

let alphaEnabled = true
let dashboardOrderComplete = true
const apiServer = await startCorsJsonApi((request) => ({
  body: request.url?.startsWith('/api/alpha/')
    ? { characterId: 7, name: 'Alpha Seven' }
    : {
        enabledModuleIds: alphaEnabled ? ['alpha'] : [],
        shellNavigationOrder: {
          dashboard:
            alphaEnabled && dashboardOrderComplete
              ? [{ ownerId: 'alpha', navigationId: 'alpha-icon-override' }]
              : [],
          character: alphaEnabled ? [{ ownerId: 'alpha', navigationId: 'alpha-default-icon' }] : [],
        },
      },
}))
process.env.NUXT_PUBLIC_API_BASE = apiServer.origin

afterAll(apiServer.close)

describe('platform Nuxt module fixture', async () => {
  const rootDir = fileURLToPath(new URL('./fixtures/basic', import.meta.url))
  await setup({
    rootDir,
    browser: true,
    server: true,
    setupTimeout: 120_000,
  })

  it('supports the application Nuxt version and renders a nested feature page', async () => {
    alphaEnabled = true
    const html = await $fetch('/characters/7/alpha')

    expect(html).toContain('data-testid="character-shell"')
    expect(html).toContain('data-testid="alpha-page"')
  })

  it('keeps route-derived invalid subjects inert', async () => {
    alphaEnabled = true

    await expect($fetch('/characters/not-a-number/alpha')).resolves.toContain(
      'data-testid="alpha-page"',
    )
  })

  it('exposes typed protected queries and shared interaction primitives to a feature', async () => {
    alphaEnabled = true
    apiServer.setAllowedOrigin(useTestContext().url)
    const page = await createPage('/characters/7/alpha')

    await page.getByText('Alpha Seven', { exact: true }).waitFor({ state: 'visible' })
    expect(await page.getByRole('img', { name: 'Alpha character' }).getAttribute('src')).toMatch(
      /\/characters\/7\/portrait/,
    )
    await page.getByRole('button', { name: 'Next page' }).click()
    expect(await page.getByText('Page 2 of 2', { exact: true }).isVisible()).toBe(true)
    await page.getByRole('button', { name: 'Confirm record' }).click()
    expect(await page.getByRole('dialog').textContent()).toContain('Confirm alpha record')
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click()
    await page.getByText('Alpha record confirmed.', { exact: true }).waitFor({ state: 'attached' })
  })

  it('renders shared authorization and stale resource states', async () => {
    alphaEnabled = true

    await expect($fetch('/characters/7/alpha?state=authorization')).resolves.toContain(
      'Alpha authorization required',
    )
    await expect($fetch('/characters/7/alpha?state=stale')).resolves.toContain(
      'Showing the last available record.',
    )
    const retainedAuthorization = await $fetch(
      '/characters/7/alpha?state=authorization&retained=true',
    )
    expect(retainedAuthorization).toContain('Alpha nested page')
    expect(retainedAuthorization).not.toContain('Alpha authorization required')
  })

  it('rejects direct disabled-page navigation and restores it without rebuilding', async () => {
    alphaEnabled = false
    await expect($fetch('/characters/7/alpha')).rejects.toMatchObject({ statusCode: 404 })

    alphaEnabled = true
    await expect($fetch('/characters/7/alpha')).resolves.toContain('Loading alpha record')
  })

  it('filters runtime navigation without rebuilding', async () => {
    alphaEnabled = true
    dashboardOrderComplete = true
    apiServer.setAllowedOrigin(useTestContext().url)
    const page = await createPage('/')
    await page.getByRole('link', { name: 'Alpha', exact: true }).waitFor({ state: 'visible' })

    alphaEnabled = false
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('link', { name: 'Alpha', exact: true }).waitFor({ state: 'hidden' })
    const disabledPage = await page.goto(new URL('/characters/7/alpha', page.url()).href, {
      waitUntil: 'networkidle',
    })
    expect(disabledPage?.status()).toBe(404)
  })

  it('retains enabled navigation missing from an older runtime order', async () => {
    alphaEnabled = true
    dashboardOrderComplete = false
    apiServer.setAllowedOrigin(useTestContext().url)
    const page = await createPage('/')
    const link = page.getByRole('link', { name: 'Alpha override', exact: true })

    await link.waitFor({ state: 'visible' })
    expect(await link.isVisible()).toBe(true)
    expect(await page.locator('[data-testid="character-navigation"] a').allTextContents()).toEqual([
      'Overview',
      'Skills',
      'Clones',
      'Finance',
      'Alpha',
      'Assets',
      'History',
      'Mail',
    ])
  })

  it('emits typed metadata with module icon defaults and entry overrides', async () => {
    const vfs = useTestContext().nuxt!.vfs
    const navigation = vfs['#build/eve-space-platform/navigation.ts']
    const pageMetaTypes = vfs['#build/types/eve-space-platform-page-meta.d.ts']

    expect(navigation).toBeTypeOf('string')
    expect(pageMetaTypes).toBeTypeOf('string')
    expect(navigation).toContain('"navigationId":"alpha-default-icon"')
    expect(navigation).toContain('"icon":"character"')
    expect(navigation).toContain('"navigationId":"alpha-icon-override"')
    expect(navigation).toContain('"icon":"settings"')
    expect(navigation).toContain(
      '{"moduleId":"alpha","pageId":"alpha-record","pageName":"eve-alpha-record","audience":"authenticated"}',
    )
    expect(pageMetaTypes).toContain('platformAudience?: PlatformNavigationAudience')
  })
})
