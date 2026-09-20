import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

const fixtureRoot = fileURLToPath(
  new URL('../fixtures/platform-module-conformance', import.meta.url),
)

describe.each(['enabled', 'disabled'] as const)('%s module composition probe', (state) => {
  it('keeps registry import, factory composition, and Nuxt setup side-effect-free', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const interval = vi.spyOn(globalThis, 'setInterval')
    const timeout = vi.spyOn(globalThis, 'setTimeout')
    await import(
      `${pathToFileURL(`${fixtureRoot}/features/conformance/module.config.ts`).href}?state=${state}`
    )
    const server = await import(
      `${pathToFileURL(`${fixtureRoot}/features/conformance/server/src/index.ts`).href}?state=${state}`
    )
    const nuxtModule = (
      await import(
        `${pathToFileURL(`${fixtureRoot}/features/conformance/nuxt/src/module.ts`).href}?state=${state}`
      )
    ).default
    const capabilities = {
      coreData: {},
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      persistence: {},
    }
    const readConformanceSnapshot = vi.fn()
    const upsertConformanceSnapshot = vi.fn()

    server.conformanceRoutes(capabilities)
    server.conformanceActivityProvider({
      collectionStatus: { read: vi.fn() },
      coreData: {},
      logger: capabilities.logger,
      persistence: { readConformanceSnapshot },
    })
    server.conformanceStatusResource.request({
      kind: 'character',
      characterId: 7,
      lifecycleId: 'lifecycle-7',
    })
    expect(nuxtModule).toBeDefined()

    expect(fetch).not.toHaveBeenCalled()
    expect(interval).not.toHaveBeenCalled()
    expect(timeout).not.toHaveBeenCalled()
    expect(readConformanceSnapshot).not.toHaveBeenCalled()
    expect(upsertConformanceSnapshot).not.toHaveBeenCalled()
  }, 15_000)
})
