import { $fetch, createPage, setup, useTestContext } from '@nuxt/test-utils/e2e'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { startCorsJsonApi } from '../../../tests/support/cors-json-api'

let alphaEnabled = true
const apiServer = await startCorsJsonApi(() => ({
  body: {
    enabledModuleIds: alphaEnabled ? ['alpha'] : [],
    shellNavigationOrder: {
      dashboard: alphaEnabled ? [{ ownerId: 'alpha', navigationId: 'alpha-icon-override' }] : [],
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

  it('rejects direct disabled-page navigation and restores it without rebuilding', async () => {
    alphaEnabled = false
    await expect($fetch('/characters/7/alpha')).rejects.toMatchObject({ statusCode: 404 })

    alphaEnabled = true
    await expect($fetch('/characters/7/alpha')).resolves.toContain('Alpha nested page')
  })

  it('filters runtime navigation without rebuilding', async () => {
    alphaEnabled = true
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

  it('emits typed metadata with module icon defaults and entry overrides', async () => {
    const vfs = useTestContext().nuxt!.vfs
    const navigation = vfs['#build/eve-space-platform/navigation.ts']
    const pageMetaTypes = vfs['#build/types/eve-space-platform-page-meta.d.ts']

    expect(navigation).toBeTypeOf('string')
    expect(pageMetaTypes).toBeTypeOf('string')
    expect(navigation).toContain('"navigationId":"alpha-default-icon"')
    expect(navigation).toContain('"icon":"character"')
    expect(navigation).toContain('"navigationId":"alpha-icon-override"')
    expect(navigation).toContain('"icon":"status"')
    expect(navigation).toContain(
      '{"moduleId":"alpha","pageName":"eve-alpha-record","audience":"authenticated"}',
    )
    expect(pageMetaTypes).toContain('platformAudience?: PlatformNavigationAudience')
  })
})
