// @vitest-environment node

import { $fetch, setup } from '@nuxt/test-utils/e2e'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const apiServer = createServer((_request, response) => {
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
    build: true,
    browser: false,
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
})
