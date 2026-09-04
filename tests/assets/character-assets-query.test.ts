import { PiniaColada, useQuery } from '@pinia/colada'
import { flushPromises } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { createPinia } from 'pinia'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it, vi } from 'vitest'
import { unauthenticatedSession } from '../../app/queries/auth'
import {
  canRunCharacterAssetsQuery,
  characterAssetsQuery,
  type CharacterAssetsAccess,
} from '../../app/queries/character-assets'
import { clearAuthenticatedQueries, removeCharacterQueries } from '../../app/queries/query-cache'
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

describe('character Assets private query', () => {
  it('uses isolated hierarchical identities and the one-hour memory policy', () => {
    expect(PRIVATE_QUERY_KEYS.characterAssets(7)).toEqual(['private', 'characters', 7, 'assets'])
    expect(PRIVATE_QUERY_KEYS.characterAssets(7)).not.toEqual(PRIVATE_QUERY_KEYS.characterAssets(8))
    expect(QUERY_POLICY.characterAssets).toEqual({
      staleTime: 60 * 60_000,
      gcTime: QUERY_GC_TIME,
    })
  })

  it('requires browser execution, authentication, exact ownership, and a positive safe ID', () => {
    expect(canRunCharacterAssetsQuery(allowed, 7)).toBe(true)
    expect(canRunCharacterAssetsQuery({ ...allowed, isClient: false }, 7)).toBe(false)
    expect(canRunCharacterAssetsQuery({ ...allowed, authenticated: false }, 7)).toBe(false)
    expect(canRunCharacterAssetsQuery({ ...allowed, ownsCharacter: false }, 7)).toBe(false)
    for (const id of [0, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(canRunCharacterAssetsQuery(allowed, id)).toBe(false)
    }
  })

  it('does not issue the protected request during server rendering', async () => {
    const fetchRequest = vi.spyOn(globalThis, 'fetch')
    const Root = defineComponent({
      setup() {
        useQuery(
          characterAssetsQuery({
            apiClient,
            characterId: 7,
            access: { ...allowed, isClient: false },
          }),
        )
        return () => h('span', 'assets locked')
      },
    })
    const app = createSSRApp(Root)
    app.use(createPinia())
    app.use(PiniaColada, coladaOptions)

    await expect(renderToString(app)).resolves.toContain('assets locked')
    expect(fetchRequest).not.toHaveBeenCalled()
    fetchRequest.mockRestore()
  })

  it('loads the inferred route and rejects a mismatched response identity', async () => {
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/assets', () =>
        HttpResponse.json(assetResponse(8)),
      ),
    )
    let error: unknown
    const Root = defineComponent({
      setup() {
        const result = useQuery({
          ...characterAssetsQuery({ apiClient, characterId: 7, access: allowed }),
          retry: 0,
        })
        return () => {
          error = result.error.value
          return h('span')
        }
      },
    })
    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(error).toBeInstanceOf(ApiQueryError)
    expect(error).toMatchObject({ status: 409, code: 'ASSETS_IDENTITY_MISMATCH' })
    wrapper.unmount()
  })

  it('maps non-200 responses through the API error contract', async () => {
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/assets', () =>
        HttpResponse.json(
          {
            code: 'EVE_SCOPE_REQUIRED',
            message: 'Grant asset access.',
            authorizeUrl: '/reauthorize/7',
            requiredScope: 'esi-assets.read_assets.v1',
          },
          { status: 403 },
        ),
      ),
    )
    let error: unknown
    const Root = defineComponent({
      setup() {
        const result = useQuery({
          ...characterAssetsQuery({ apiClient, characterId: 7, access: allowed }),
          retry: 0,
        })
        return () => {
          error = result.error.value
          return h('span')
        }
      },
    })
    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(error).toMatchObject({
      status: 403,
      code: 'EVE_SCOPE_REQUIRED',
      message: 'Grant asset access.',
      authorizeUrl: '/reauthorize/7',
      requiredScope: 'esi-assets.read_assets.v1',
    })
    wrapper.unmount()
  })

  it('isolates switched characters and clears private state on removal or logout', () => {
    localStorage.clear()
    sessionStorage.clear()
    const Root = defineComponent({ setup: () => () => h('span') })
    const { queryCache, wrapper } = mountWithQueryPlugins(Root)
    for (const id of [7, 8]) {
      const key = PRIVATE_QUERY_KEYS.characterAssets(id)
      queryCache.ensure({ key, query: async () => assetResponse(id) })
      queryCache.setQueryData(key, assetResponse(id))
    }

    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterAssets(7))).toMatchObject({
      characterId: 7,
    })
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterAssets(8))).toMatchObject({
      characterId: 8,
    })
    expect(localStorage).toHaveLength(0)
    expect(sessionStorage).toHaveLength(0)

    removeCharacterQueries(queryCache, 7)
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterAssets(7))).toBeUndefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterAssets(8))).toBeDefined()

    clearAuthenticatedQueries(queryCache, unauthenticatedSession)
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterAssets(8))).toBeUndefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.session())).toEqual(unauthenticatedSession)
    wrapper.unmount()
  })
})

function assetResponse(characterId: number) {
  return {
    characterId,
    assets: [],
    enrichment: { types: 'complete', names: 'complete', locations: 'complete' },
    cachedUntil: '2026-09-03T13:00:00.000Z',
    validatedAt: '2026-09-03T12:00:00.000Z',
    stale: false,
  }
}
