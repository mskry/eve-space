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
        enabledSections: [],
        shellNavigationOrder: {
          character: alphaEnabled ? [{ ownerId: 'alpha', navigationId: 'alpha-default-icon' }] : [],
          dashboard:
            alphaEnabled && dashboardOrderComplete
              ? [{ ownerId: 'alpha', navigationId: 'alpha-icon-override' }]
              : [],
        },
      },
}))
process.env.NUXT_PUBLIC_API_BASE = apiServer.origin

afterAll(apiServer.close)

describe('platform Nuxt module fixture', async () => {
  const rootDir = fileURLToPath(new URL('./fixtures/basic', import.meta.url))
  await setup({
    browser: true,
    rootDir,
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

  it('loads only the reviewer panel selected by stable contribution identity', async () => {
    const page = await createPage('/')

    expect(await page.getByTestId('alpha-reviewer-panel').count()).toBe(0)
    await page.getByRole('button', { name: 'Load reviewer panel' }).click()
    await page.getByTestId('alpha-reviewer-panel').waitFor({ state: 'visible' })
    expect(await page.getByTestId('beta-reviewer-panel').count()).toBe(0)
    expect(await page.getByTestId('alpha-reviewer-panel').textContent()).toContain(
      'user-1 at organization version 7',
    )

    await page.getByRole('button', { name: 'Load beta reviewer panel' }).click()
    await page.getByTestId('beta-reviewer-panel').waitFor({ state: 'visible' })
    expect(await page.getByTestId('alpha-reviewer-panel').count()).toBe(0)
  })

  it.each([
    { height: 844, width: 390 },
    { height: 900, width: 1440 },
  ])('keeps synthetic reviewer panels inside the $width px viewport', async ({ height, width }) => {
    const page = await createPage('/')
    await page.setViewportSize({ height, width })
    await page.getByRole('button', { exact: true, name: 'Load reviewer panel' }).click()
    await page.getByTestId('alpha-reviewer-panel').waitFor({ state: 'visible' })

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
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

  it('keeps retained feature data without duplicating the global persistence notice', async () => {
    const restored = await $fetch('/characters/7/alpha?retained=true&presentation=refresh-failed')
    expect(restored).toContain('Alpha nested page')
    expect(restored).not.toContain('Historical data, refresh failed.')

    const serverStale = await $fetch(
      '/characters/7/alpha?state=stale&retained=true&presentation=server-stale',
    )
    expect(serverStale).toContain('Alpha nested page')
    expect(serverStale).not.toContain('Server-stale data.')
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
    await page.getByRole('link', { exact: true, name: 'Alpha' }).waitFor({ state: 'visible' })

    alphaEnabled = false
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('link', { exact: true, name: 'Alpha' }).waitFor({ state: 'hidden' })
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
    const link = page.getByRole('link', { exact: true, name: 'Alpha override' })

    await link.waitFor({ state: 'visible' })
    expect(await link.isVisible()).toBe(true)
    expect(
      await page.locator('[data-testid="character-navigation"] a').allTextContents(),
    ).toStrictEqual([
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
    const queryAdmissionScopes = vfs['#build/eve-space-platform/query-admission-scopes.ts']
    const reviewerPanels = vfs['#build/eve-space-platform/reviewer-panels.ts']
    const pageMetaTypes = vfs['#build/types/eve-space-platform-page-meta.d.ts']

    expect(navigation).toBeTypeOf('string')
    expect(queryAdmissionScopes).toBeTypeOf('string')
    expect(reviewerPanels).toBeTypeOf('string')
    expect(pageMetaTypes).toBeTypeOf('string')
    expect(navigation).toContain('"navigationId":"alpha-default-icon"')
    expect(navigation).toContain('"icon":"character"')
    expect(navigation).toContain('"navigationId":"alpha-icon-override"')
    expect(navigation).toContain('"icon":"settings"')
    expect(navigation).toContain(
      '{"audience":"authenticated","moduleId":"alpha","pageId":"alpha-record","pageName":"eve-alpha-record"}',
    )
    expect(pageMetaTypes).toContain('platformAudience?: PlatformNavigationAudience')
    expect(queryAdmissionScopes).toContain(
      '[{"moduleId":"alpha","routeId":"alpha-summary","admissionScope":"organization:v1:alpha:member:alpha.view","authorization":"authenticated-session","audience":"member","requiredPermission":"alpha.view"},{"moduleId":"alpha","routeId":"alpha-record","admissionScope":"organization:v1:alpha:member:alpha.view","authorization":"owned-character","audience":"member","requiredPermission":"alpha.view"},{"moduleId":"beta","routeId":"beta-details","admissionScope":"organization:v1:beta:director:beta.review","authorization":"authenticated-session","audience":"director","requiredPermission":"beta.review","target":"managed-organization-character"}]',
    )
    expect(reviewerPanels).toContain(
      'load: () => import("@eve-space/alpha-nuxt/reviewer/overview")',
    )
    expect(reviewerPanels).toContain('load: () => import("@eve-space/beta-nuxt/reviewer/details")')
    expect(reviewerPanels).toContain('"moduleId":"alpha","contributionId":"overview"')
    expect(reviewerPanels).toContain('"moduleId":"beta","contributionId":"details"')
    expect(reviewerPanels.indexOf('"moduleId":"alpha"')).toBeLessThan(
      reviewerPanels.indexOf('"moduleId":"beta"'),
    )
    expect(reviewerPanels).not.toContain(rootDir)
  })
})
