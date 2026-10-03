// @vitest-environment node
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { buildSchema, GraphQLError } from 'graphql'
import { createPage, setup } from '@nuxt/test-utils/e2e'
import type { Page } from '@playwright/test'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createGraphQLHostAdapter } from '../../api/src/graphql/host-adapter'

const requests: Request[] = []
const schema = buildSchema(`
  type Query {
    publicValue: String
    deniedValue: String
    ownedCharacter(characterId: ID!): OwnedCharacter
  }
  type OwnedCharacter { characterId: ID!, assets(first: Int!, after: String): AssetPage }
  type AssetPage { assets: [Asset!]!, pageInfo: PageInfo! }
  type Asset { itemId: ID! }
  type PageInfo { hasNextPage: Boolean!, endCursor: String, restartRequired: Boolean! }
`)
let assetsScope = true
let sourceRevision = 1
interface ViewerContext {
  readonly signal: AbortSignal
  readonly owner: string | null
}
interface AssetPageArguments {
  first: number
  after?: string | null
}

const fixtureAssets = ({ first, after }: AssetPageArguments) => {
  if (!assetsScope)
    throw new GraphQLError('Authorize the required scope.', {
      extensions: { code: 'EVE_SCOPE_REQUIRED' },
    })
  if (after && after !== `fixture-${sourceRevision}`)
    throw new GraphQLError('Restart asset traversal.', {
      extensions: { code: 'ASSET_CURSOR_RESTART' },
    })
  if (first !== 1) throw new GraphQLError('Select one fixture row.')
  return {
    assets: [{ itemId: after ? '1000000000002' : '1000000000001' }],
    pageInfo: {
      hasNextPage: !after,
      endCursor: after ? null : `fixture-${sourceRevision}`,
      restartRequired: false,
    },
  }
}

const fields = schema.getQueryType()!.getFields()
fields.publicValue!.resolve = () => '123456789012345678.12345'
fields.deniedValue!.resolve = () => {
  throw new GraphQLError('Authorize the required scope.', {
    extensions: { code: 'EVE_SCOPE_REQUIRED' },
  })
}
fields.ownedCharacter!.resolve = (
  _parent,
  { characterId }: { characterId: string },
  context: ViewerContext,
) => {
  if (!context.owner) throw new GraphQLError('Sign in.', { extensions: { code: 'AUTH_REQUIRED' } })
  if (context.owner !== 'fixture-owner' || characterId !== '7001')
    throw new GraphQLError('Character unavailable.', {
      extensions: { code: 'CHARACTER_NOT_FOUND' },
    })
  return { characterId, assets: fixtureAssets }
}

const app = new Hono()
  .use('*', cors({ credentials: true, origin: (origin) => origin }))
  .use('*', async (context, next) => {
    requests.push(context.req.raw)
    await next()
  })
  .get('/auth/session', (context) => context.json({ authenticated: false }))
  .get('/auth/config', (context) => context.json({ configured: false }))
  .get('/api/admin/session', (context) => context.json({ authenticated: false }))
  .get('/api/modules', (context) =>
    context.json({ enabledModuleIds: [], shellNavigationOrder: { character: [], dashboard: [] } }),
  )
  .route(
    '/graphql',
    createGraphQLHostAdapter(
      schema,
      (request): ViewerContext => ({
        signal: request.signal,
        owner: /viewer_owner=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1] ?? null,
      }),
      [
        { field: 'Query.publicValue', protected: false, cost: 1, sourceCost: 0 },
        { field: 'Query.deniedValue', protected: true, cost: 1, sourceCost: 0 },
        { field: 'Query.ownedCharacter', protected: true, cost: 1, sourceCost: 0 },
        {
          field: 'OwnedCharacter.assets',
          protected: true,
          cost: 1,
          sourceCost: 1,
          list: { argument: 'first', defaultSize: 1, maximum: 1 },
        },
        {
          field: 'AssetPage.assets',
          protected: true,
          cost: 1,
          sourceCost: 0,
          projection: true,
          list: { defaultSize: 1, maximum: 1 },
        },
      ],
    ),
  )
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
await once(server, 'listening')
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Expected a TCP fixture listener.')
const apiOrigin = `http://127.0.0.1:${address.port}`
process.env.NUXT_PUBLIC_API_BASE = apiOrigin
const pages = new Set<Page>()

afterAll(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
)

const execute = async (page: Page, query: string) => {
  const editor = page.locator('.monaco-editor textarea').first()
  await editor.waitFor()
  await editor.focus()
  await editor.press('ControlOrMeta+A')
  await page
    .context()
    .grantPermissions(['clipboard-read', 'clipboard-write'], { origin: apiOrigin })
  await page.evaluate((document) => navigator.clipboard.writeText(document), query)
  await editor.press('ControlOrMeta+V')
  await expect
    .poll(async () =>
      (await page.locator('.monaco-editor .view-lines').first().innerText()).replace(/\s+/g, ''),
    )
    .toBe(query.replace(/\s+/g, ''))
  await editor.press('ControlOrMeta+Enter')
}

const responseText = async (page: Page) =>
  (await page.locator('.graphiql-response').innerText()).replaceAll('\u00a0', ' ')

const assetQuery = (after: string | null = null) => {
  const cursor = after ? `, after: "${after}"` : ''
  return `{ ownedCharacter(characterId: "7001") {
    assets(first: 1${cursor}) { assets { itemId } pageInfo { hasNextPage endCursor restartRequired } }
  } }`
}

describe('standard GraphiQL production journey', async () => {
  await setup({
    browser: true,
    build: false,
    captureServerLogs: false,
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    server: true,
    nuxtConfig: {
      nitro: { output: { dir: fileURLToPath(new URL('../../.output-e2e', import.meta.url)) } },
    },
  })

  beforeEach(() => {
    requests.length = 0
    assetsScope = true
    sourceRevision = 1
  })
  afterEach(async () => {
    await Promise.all([...pages].map((page) => page.close()))
    pages.clear()
  })

  it('discovers arbitrary fields directly without third-party requests or persisted queries', async () => {
    const page = await createPage()
    pages.add(page)
    const externalRequests: string[] = []
    page.on('request', (request) => {
      if (request.url().startsWith('https://')) externalRequests.push(request.url())
    })
    await page.goto(`${apiOrigin}/graphql`)
    await execute(page, '{ publicValue }')
    await expect.poll(() => responseText(page)).toContain('123456789012345678.12345')
    expect(page.url()).toBe(`${apiOrigin}/graphql`)
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).filter((key) => key.startsWith('graphiql')),
      ),
    ).toEqual([])
    expect(externalRequests).toEqual([])
    expect(
      requests.filter(
        (request) => request.method === 'POST' && new URL(request.url).pathname === '/graphql',
      ).length,
    ).toBeGreaterThan(0)
  })

  it('renders partial field errors without retrying or retaining output after reload', async () => {
    const page = await createPage()
    pages.add(page)
    await page.goto(`${apiOrigin}/graphql`)
    await execute(page, '{ publicValue }')
    await expect.poll(() => responseText(page)).toContain('123456789012345678.12345')
    const attempts = requests.filter((request) => request.method === 'POST').length
    await execute(page, '{ publicValue deniedValue }')
    await expect.poll(() => responseText(page)).toContain('EVE_SCOPE_REQUIRED')
    expect(await responseText(page)).toContain('123456789012345678.12345')
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(attempts + 1)
    await page.reload()
    await page.locator('.monaco-editor textarea').first().waitFor()
    expect(await responseText(page)).not.toContain('123456789012345678.12345')
    expect(await responseText(page)).not.toContain('EVE_SCOPE_REQUIRED')
  })

  it('executes credentialed owned pages and mixed subjects, showing scope and restart outcomes', async () => {
    const page = await createPage()
    pages.add(page)
    await page
      .context()
      .addCookies([{ name: 'viewer_owner', value: 'fixture-owner', url: apiOrigin }])
    await page.goto(`${apiOrigin}/graphql`)
    await execute(page, assetQuery())
    await expect.poll(() => responseText(page)).toContain('1000000000001')
    expect(await responseText(page)).toContain('fixture-1')
    await execute(page, assetQuery('fixture-1'))
    await expect.poll(() => responseText(page)).toContain('1000000000002')
    expect(await responseText(page)).not.toContain('1000000000001')
    sourceRevision = 2
    await execute(page, assetQuery('fixture-1'))
    await expect.poll(() => responseText(page)).toContain('ASSET_CURSOR_RESTART')
    expect(await responseText(page)).not.toContain('1000000000002')
    assetsScope = false
    const attempts = requests.filter((request) => request.method === 'POST').length
    await execute(page, assetQuery())
    await expect.poll(() => responseText(page)).toContain('EVE_SCOPE_REQUIRED')
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(attempts + 1)
    await execute(
      page,
      '{ publicValue mine: ownedCharacter(characterId: "7001") { characterId } other: ownedCharacter(characterId: "7002") { characterId } }',
    )
    await expect.poll(() => responseText(page)).toContain('CHARACTER_NOT_FOUND')
    expect(await responseText(page)).toContain('7001')
    expect(await responseText(page)).toContain('123456789012345678.12345')
    const last = requests.findLast((request) => request.method === 'POST')!
    expect(last.headers.get('cookie')).toContain('viewer_owner=fixture-owner')
    expect(last.headers.get('content-type')).toContain('application/json')
  })

  it('clears private viewer output on reload and reevaluates a changed or missing session', async () => {
    const page = await createPage()
    pages.add(page)
    await page
      .context()
      .addCookies([{ name: 'viewer_owner', value: 'fixture-owner', url: apiOrigin }])
    await page.goto(`${apiOrigin}/graphql`)
    await execute(page, assetQuery())
    await expect.poll(() => responseText(page)).toContain('1000000000001')
    await page
      .context()
      .addCookies([{ name: 'viewer_owner', value: 'different-owner', url: apiOrigin }])
    await page.reload()
    await page.locator('.monaco-editor textarea').first().waitFor()
    expect(await responseText(page)).not.toContain('1000000000001')
    await execute(page, assetQuery())
    await expect.poll(() => responseText(page)).toContain('CHARACTER_NOT_FOUND')
    expect(await responseText(page)).not.toContain('1000000000001')
    await page.context().clearCookies()
    await execute(page, assetQuery())
    await expect.poll(() => responseText(page)).toContain('AUTH_REQUIRED')
    expect(await responseText(page)).not.toContain('1000000000001')
    expect(
      await page.evaluate(() => [
        ...Object.keys(localStorage).filter((key) => key.startsWith('graphiql')),
        ...Object.keys(sessionStorage).filter((key) => key.startsWith('graphiql')),
      ]),
    ).toEqual([])
    expect(page.url()).toBe(`${apiOrigin}/graphql`)
  })
})
