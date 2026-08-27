import { $fetch, setup, useTestContext } from '@nuxt/test-utils/e2e'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

let alphaEnabled = true
const apiServer = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(
    JSON.stringify({
      enabledModuleIds: alphaEnabled ? ['alpha'] : [],
      shellNavigationOrder: { dashboard: [], character: [] },
    }),
  )
})
await new Promise<void>((resolve) => apiServer.listen(0, '127.0.0.1', resolve))
const apiAddress = apiServer.address() as AddressInfo
process.env.NUXT_PUBLIC_API_BASE = `http://127.0.0.1:${apiAddress.port}`

afterAll(() => new Promise<void>((resolve) => apiServer.close(() => resolve())))

describe('platform Nuxt module fixture', async () => {
  const rootDir = fileURLToPath(new URL('./fixtures/basic', import.meta.url))
  await setup({
    rootDir,
    browser: false,
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
