import { PiniaColada, useQuery } from '@pinia/colada'
import { flushPromises } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { createPinia } from 'pinia'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it, vi } from 'vitest'
import {
  canRunCharacterAssetRoutesQuery,
  characterAssetRoutesQuery,
} from '../../app/queries/character-asset-routes'
import type { CharacterAssetsAccess } from '../../app/queries/character-assets'
import { PRIVATE_QUERY_KEYS } from '../../app/queries/query-keys'
import { QUERY_POLICY } from '../../app/queries/query-policy'
import { createApiClient } from '../../app/utils/api-client'
import { coladaOptions, QUERY_GC_TIME } from '../../app/utils/colada-options'
import { ApiQueryError } from '../../app/utils/query-error'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'
import { queryServer } from '../support/query-server'

const apiClient = createApiClient('http://localhost')
const allowed: CharacterAssetsAccess = {
  isClient: true,
  authenticated: true,
  ownsCharacter: true,
}

describe('character asset route query', () => {
  it('uses a private canonical origin-aware identity and bounded one-hour freshness', () => {
    const options = characterAssetRoutesQuery({
      apiClient,
      characterId: 7,
      originSystemId: 30_000_001,
      destinationSystemIds: [30_000_003, 30_000_002, 30_000_003, 0],
      access: allowed,
    })

    expect(options.key).toEqual([
      'private',
      'characters',
      7,
      'assets',
      'routes',
      30_000_001,
      'shortest',
      [30_000_002, 30_000_003],
    ])
    expect(options.key).not.toEqual(
      PRIVATE_QUERY_KEYS.characterAssetRoutes(8, 30_000_001, [30_000_002, 30_000_003]),
    )
    expect(options.key).not.toEqual(
      PRIVATE_QUERY_KEYS.characterAssetRoutes(7, 30_000_004, [30_000_002, 30_000_003]),
    )
    expect(QUERY_POLICY.characterAssetRoutes).toEqual({
      staleTime: 60 * 60_000,
      gcTime: QUERY_GC_TIME,
    })
  })

  it('requires browser ownership, valid identities, and at least one bounded destination', () => {
    expect(canRunCharacterAssetRoutesQuery(allowed, 7, 1, [2])).toBe(true)
    expect(canRunCharacterAssetRoutesQuery({ ...allowed, isClient: false }, 7, 1, [2])).toBe(false)
    expect(canRunCharacterAssetRoutesQuery({ ...allowed, authenticated: false }, 7, 1, [2])).toBe(
      false,
    )
    expect(canRunCharacterAssetRoutesQuery({ ...allowed, ownsCharacter: false }, 7, 1, [2])).toBe(
      false,
    )
    expect(canRunCharacterAssetRoutesQuery(allowed, 0, 1, [2])).toBe(false)
    expect(canRunCharacterAssetRoutesQuery(allowed, 7, 0, [2])).toBe(false)
    expect(canRunCharacterAssetRoutesQuery(allowed, 7, 1, [])).toBe(false)
    expect(
      canRunCharacterAssetRoutesQuery(
        allowed,
        7,
        1,
        Array.from({ length: 10_001 }, (_, index) => index + 1),
      ),
    ).toBe(false)
  })

  it('does not execute during SSR', async () => {
    const fetchRequest = vi.spyOn(globalThis, 'fetch')
    const Root = defineComponent({
      setup() {
        useQuery(
          characterAssetRoutesQuery({
            apiClient,
            characterId: 7,
            originSystemId: 1,
            destinationSystemIds: [2],
            access: { ...allowed, isClient: false },
          }),
        )
        return () => h('span', 'routes locked')
      },
    })
    const app = createSSRApp(Root)
    app.use(createPinia())
    app.use(PiniaColada, coladaOptions)

    await expect(renderToString(app)).resolves.toContain('routes locked')
    expect(fetchRequest).not.toHaveBeenCalled()
    fetchRequest.mockRestore()
  })

  it('submits one canonical shortest-policy batch and accepts disconnected results', async () => {
    let requestBody: unknown
    queryServer.use(
      http.post('http://localhost/api/universe/routes', async ({ request }) => {
        requestBody = await request.json()
        return HttpResponse.json({
          originSystemId: 1,
          policy: { kind: 'shortest' },
          sdeBuildNumber: 1234,
          routes: [
            { destinationSystemId: 2, jumps: 1 },
            { destinationSystemId: 3, jumps: null },
          ],
        })
      }),
    )
    let result: unknown
    const Root = defineComponent({
      setup() {
        const query = useQuery(
          characterAssetRoutesQuery({
            apiClient,
            characterId: 7,
            originSystemId: 1,
            destinationSystemIds: [3, 2, 3],
            access: allowed,
          }),
        )
        return () => {
          result = query.data.value
          return h('span')
        }
      },
    })
    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(requestBody).toEqual({
      originSystemId: 1,
      destinationSystemIds: [2, 3],
      policy: { kind: 'shortest' },
    })
    expect(result).toMatchObject({ routes: [{ jumps: 1 }, { jumps: null }] })
    wrapper.unmount()
  })

  it('rejects response identity drift', async () => {
    queryServer.use(
      http.post('http://localhost/api/universe/routes', () =>
        HttpResponse.json({
          originSystemId: 9,
          policy: { kind: 'shortest' },
          sdeBuildNumber: 1234,
          routes: [{ destinationSystemId: 2, jumps: 1 }],
        }),
      ),
    )
    let error: unknown
    const Root = defineComponent({
      setup() {
        const query = useQuery({
          ...characterAssetRoutesQuery({
            apiClient,
            characterId: 7,
            originSystemId: 1,
            destinationSystemIds: [2],
            access: allowed,
          }),
          retry: 0,
        })
        return () => {
          error = query.error.value
          return h('span')
        }
      },
    })
    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(error).toBeInstanceOf(ApiQueryError)
    expect(error).toMatchObject({ status: 409, code: 'ASSET_ROUTES_IDENTITY_MISMATCH' })
    wrapper.unmount()
  })
})
