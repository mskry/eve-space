import { beforeEach, expect, test, vi } from 'vitest'
import { EsiHttpError } from '@evespace/esi-client'
import type {
  PlatformGraphQLReadCapabilities,
  PlatformInstalledGraphQLContribution,
} from '@eve-space/platform-module-contract/graphql'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  owned: vi.fn(),
  authorization: vi.fn(),
  enabled: true,
  catalogue: vi.fn(),
  profiles: vi.fn(),
  persistence: vi.fn(),
  assets: vi.fn(),
}))
vi.mock('../src/characters/asset-connection.js', () => ({
  readCharacterAssetConnection: mocks.assets,
}))
vi.mock('../src/generated/platform/installed-module-graphql.js', async (original) => {
  const installed = await original<{
    installedGraphQLContributions: readonly PlatformInstalledGraphQLContribution[]
  }>()
  const { definePlatformGraphQLRead } = await import('@eve-space/platform-module-contract/graphql')
  const fixture: PlatformInstalledGraphQLContribution = {
    moduleId: 'fixture',
    publisherPackage: '@example/fixture-manifest',
    id: 'protected-read',
    rootField: 'protectedFixture',
    exportName: 'fixtureGraphQL',
    types: ['ProtectedFixture'],
    reads: [
      {
        id: 'root',
        field: 'Query.protectedFixture',
        strategy: 'authenticated-session',
        cost: 1,
        sourceCost: 1,
        coreDataProducts: ['market-catalogue'],
        persistenceOperations: [],
      },
    ],
    definition: {
      typeDefs:
        'extend type Query { protectedFixture(id: Int!): ProtectedFixture } type ProtectedFixture { value: String }',
      reads: {
        'Query.protectedFixture': definePlatformGraphQLRead<
          PlatformGraphQLReadCapabilities<readonly ['market-catalogue']>
        >(async ({ capabilities }) => {
          await capabilities.coreData.marketCatalogue({ kind: 'revision' })
          return { value: 'value' }
        }),
      },
    },
  }
  return { installedGraphQLContributions: [...installed.installedGraphQLContributions, fixture] }
})
vi.mock('../src/auth/session-store.js', async (original) => ({
  ...(await original<object>()),
  findSession: mocks.session,
}))
vi.mock('../src/auth/character-lifecycle.js', async (original) => ({
  ...(await original<object>()),
  findOwnedCharacter: mocks.owned,
}))
vi.mock('../src/auth/character-token-store.js', async (original) => ({
  ...(await original<object>()),
  findCharacterCacheAuthorizationForLifecycle: mocks.authorization,
}))
vi.mock('../src/platform/module-settings.js', async (original) => ({
  ...(await original<object>()),
  isInstalledModuleContributionEnabled: async () => mocks.enabled,
}))
vi.mock('../src/core-data/market-catalogue-adapter.js', () => ({
  loadMarketCatalogueProduct: mocks.catalogue,
}))
vi.mock('../src/db/module-persistence-operation-transaction.js', () => ({
  createStandaloneModulePersistenceOperationInvoker: () => mocks.persistence,
}))

import { app } from '../src/index.js'
import { apiLogger } from '../src/logging.js'

const character = {
  characterId: 90000001,
  name: 'Pilot',
  isMain: true,
  corporationId: 1,
  allianceId: null,
  subjectLifecycleId: '11111111-1111-4111-8111-111111111111',
}
const request = (query: string, method = 'POST', headers = {}, signal?: AbortSignal) =>
  app.request(`/graphql${method === 'GET' ? `?query=${encodeURIComponent(query)}` : ''}`, {
    method,
    signal,
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', ...headers },
    ...(method === 'POST' && { body: JSON.stringify({ query }) }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.enabled = true
  mocks.session.mockResolvedValue({ userId: 'owner', mainCharacter: character })
  mocks.owned.mockImplementation(async (_owner, id) =>
    id === character.characterId ? character : null,
  )
  mocks.authorization.mockResolvedValue({ tokenVersion: 1, scopes: [] })
  mocks.persistence.mockResolvedValue([])
  mocks.catalogue.mockResolvedValue({})
})

test.each([false, true])(
  'rechecks four concurrent protected capabilities with session revoked: %s',
  async (revoked) => {
    mocks.catalogue.mockImplementation(async () => {
      if (revoked && mocks.catalogue.mock.calls.length === 4) mocks.session.mockResolvedValue(null)
      return {}
    })
    const response = await request(
      '{ a: protectedFixture(id: 1) { value } b: protectedFixture(id: 2) { value } c: protectedFixture(id: 3) { value } d: protectedFixture(id: 4) { value } }',
      'POST',
      { Cookie: 'eve_space_session=member' },
      AbortSignal.timeout(1000),
    )
    const body = await response.json()
    expect(body.data).toEqual(
      revoked
        ? { a: null, b: null, c: null, d: null }
        : {
            a: { value: 'value' },
            b: { value: 'value' },
            c: { value: 'value' },
            d: { value: 'value' },
          },
    )
    const denial = expect.objectContaining({ extensions: { code: 'AUTH_REQUIRED', status: 401 } })
    expect(body.errors ?? []).toEqual(revoked ? Array.from({ length: 4 }, () => denial) : [])
    expect(mocks.catalogue).toHaveBeenCalledTimes(4)
  },
)

test.each([
  [401, 'EVE_REAUTH_REQUIRED', 403],
  [403, 'EVE_REAUTH_REQUIRED', 403],
  [429, 'ESI_QUOTA_EXHAUSTED', 429],
  [503, 'ESI_UNAVAILABLE', 502],
] as const)(
  'classifies asset SDK status %s without exposing upstream details',
  async (status, code, applicationStatus) => {
    mocks.authorization.mockResolvedValue({
      tokenVersion: 1,
      scopes: ['esi-assets.read_assets.v1'],
    })
    mocks.assets.mockRejectedValue(
      new EsiHttpError({
        operationId: 'GetCharactersCharacterIdAssets',
        status,
        metadata: { headers: {}, retryAfterSeconds: 17 },
      }),
    )
    const response = await request(
      '{ ownedCharacter(characterId: "90000001") { characterId assets(first: 1) { assets { itemId } } } }',
      'POST',
      { Cookie: 'eve_space_session=member' },
    )
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const body = await response.json()
    expect(body.data).toEqual({ ownedCharacter: { characterId: '90000001', assets: null } })
    expect(body.errors).toHaveLength(1)
    expect(body.errors[0]).toMatchObject({
      path: ['ownedCharacter', 'assets'],
      extensions: { code, status: applicationStatus },
    })
    expect(body.errors[0].extensions.requiredScope).toBe(
      code === 'EVE_REAUTH_REQUIRED' ? 'esi-assets.read_assets.v1' : undefined,
    )
    expect(body.errors[0].extensions.authorizeUrl).toBe(
      code === 'EVE_REAUTH_REQUIRED' ? '/auth/eve/reauthorize/90000001' : undefined,
    )
    expect(body.errors[0].extensions.retryAfterSeconds).toBe(
      code === 'ESI_QUOTA_EXHAUSTED' ? 17 : undefined,
    )
    expect(JSON.stringify(body)).not.toContain('GetCharactersCharacterIdAssets')
  },
)

test('mounts anonymous Market with restrictive public GET caching and POST no-store', async () => {
  const response = await request('{ market { profiles { profileId } } }', 'GET')
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ data: { market: { profiles: [] } } })
  expect(response.headers.get('Cache-Control')).toMatch(/^public, max-age=(29|30)$/)
  expect(mocks.session).not.toHaveBeenCalled()
  expect(
    (await request('{ market { profiles { profileId } } }')).headers.get('Cache-Control'),
  ).toBe('no-store')
})

test.each(['revision change', 'disablement'])(
  'formats a history profile %s as restart guidance while preserving sibling data',
  async (change) => {
    const profileId = '00000000-0000-4000-8000-000000000001'
    const profile = {
      profileId,
      revision: 7,
      regionId: 10000002,
      mode: 'region',
      stationIds: [],
      watchedTypeIds: [],
      lastFailureClass: null,
    }
    let historyRead = false
    mocks.persistence.mockImplementation(async (operation: { operationId: string }) => {
      if (operation.operationId === 'list-market-profiles') {
        if (!historyRead) return [profile]
        return change === 'revision change' ? [{ ...profile, revision: 8 }] : []
      }
      if (operation.operationId === 'read-market-history') {
        historyRead = true
        return null
      }
      return []
    })
    mocks.catalogue.mockResolvedValue({
      kind: 'revision',
      revision: {
        buildNumber: 42,
        ingestVersion: 6,
        ingestedAt: '2026-10-02T00:00:00Z',
      },
    })

    const response = await request(
      `{ market { catalogueRevision { buildNumber } recentHistory: history(profileId: "${profileId}", typeId: "34") { status } } }`,
      'GET',
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({
      data: { market: { catalogueRevision: { buildNumber: '42' }, recentHistory: null } },
      errors: [
        {
          message: 'Market history profile changed. Restart this read.',
          path: ['market', 'recentHistory'],
          extensions: { code: 'MARKET_HISTORY_PROFILE_CHANGED', status: 409 },
        },
      ],
    })
    expect(historyRead).toBe(true)
  },
)

test('preserves public partial data with anonymous, disabled and exact-owner denials', async () => {
  const response = await request(
    '{ market { profiles { profileId } } ownedCharacter(characterId: "90000001") { characterId } }',
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    data: { market: { profiles: [] }, ownedCharacter: null },
    errors: [{ path: ['ownedCharacter'], extensions: { code: 'AUTH_REQUIRED', status: 401 } }],
  })
  expect(mocks.owned).not.toHaveBeenCalled()
  mocks.enabled = false
  const disabled = await request('{ market { profiles { profileId } } }', 'GET')
  expect(disabled.headers.get('Cache-Control')).toBe('no-store')
  expect(await disabled.json()).toMatchObject({
    data: { market: null },
    errors: [{ extensions: { code: 'RESOURCE_UNAVAILABLE' } }],
  })
})

test('binds member cookies to each exact subject and retains owned scope guidance', async () => {
  const response = await request(
    '{ mine: ownedCharacter(characterId: "90000001") { characterId assets(first: 1) { assets { itemId } } } other: ownedCharacter(characterId: "90000002") { characterId } }',
    'POST',
    { Cookie: 'eve_space_session=member' },
  )
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.data).toEqual({ mine: { characterId: '90000001', assets: null }, other: null })
  expect(body.errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: ['mine', 'assets'],
        extensions: expect.objectContaining({
          code: 'EVE_SCOPE_REQUIRED',
          requiredScope: 'esi-assets.read_assets.v1',
          authorizeUrl: '/auth/eve/reauthorize/90000001',
        }),
      }),
      expect.objectContaining({
        path: ['other'],
        extensions: expect.objectContaining({ code: 'CHARACTER_NOT_FOUND' }),
      }),
    ]),
  )
  expect(mocks.session).toHaveBeenCalledWith('member')
})

test('keeps skipped private fields and introspection non-storeable', async () => {
  for (const query of [
    '{ market { profiles { profileId } } ownedCharacters @skip(if: true) { items { name } } }',
    '{ __schema { queryType { name } } }',
  ]) {
    const response = await request(query, 'GET')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  }
})

test('preserves host methods, media, security, CORS and safe validation envelopes', async () => {
  const invalid = await request('{ unknown_private_secret }')
  expect(invalid.status).toBe(400)
  expect(await invalid.text()).not.toContain('unknown_private_secret')
  expect(invalid.headers.get('X-Content-Type-Options')).toBe('nosniff')
  const head = await app.request('/graphql', { method: 'HEAD' })
  expect(head.status).toBe(405)
  expect(await head.text()).toBe('')
  const preflight = await app.request('/graphql', {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'POST' },
  })
  expect(preflight.status).toBe(204)
  expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000')
  const forbidden = await app.request('/graphql', {
    method: 'POST',
    headers: { Origin: 'https://untrusted.invalid', 'Content-Type': 'text/plain' },
    body: '{}',
  })
  expect(forbidden.status).toBe(403)
  expect(forbidden.headers.get('Cache-Control')).toBe('no-store')
  const crossOrigin = await request('{ __typename }', 'POST', {
    Origin: 'https://untrusted.invalid',
  })
  expect(crossOrigin.headers.get('Access-Control-Allow-Origin')).not.toBe(
    'https://untrusted.invalid',
  )
})

test('masks unexpected errors and logs no document, variables or backend details', async () => {
  const output = vi.spyOn(console, 'info').mockImplementation(() => {})
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  apiLogger.enableLogging()
  try {
    mocks.persistence.mockRejectedValue(new Error('private_database_secret'))
    const response = await request('{ secret_alias: market { profiles { profileId } } }', 'GET')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.errors[0]).toMatchObject({
      message: 'Unexpected error.',
      path: ['secret_alias', 'profiles'],
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    })
    const logs = JSON.stringify([...output.mock.calls, ...errors.mock.calls])
    expect(logs).not.toContain('private_database_secret')
    expect(logs).not.toContain('secret_alias')
    expect(output).toHaveBeenCalledOnce()
    expect(errors).toHaveBeenCalledOnce()
  } finally {
    apiLogger.disableLogging()
    output.mockRestore()
    errors.mockRestore()
  }
})
