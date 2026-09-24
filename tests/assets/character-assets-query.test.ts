import { PiniaColada, useQuery } from '@pinia/colada'
import { flushPromises } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { createPinia } from 'pinia'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it, vi } from 'vitest'
import { unauthenticatedSession } from '../../app/queries/auth'
import { characterAssetsQuery } from '../../app/queries/character-assets'
import {
  canRunProtectedCharacterQuery,
  type ProtectedCharacterQueryAccess,
} from '../../app/queries/protected-character-query-access'
import { clearAuthenticatedQueries, removeCharacterQueries } from '../../app/queries/query-cache'
import { PRIVATE_QUERY_KEYS } from '../../app/queries/query-keys'
import { QUERY_POLICY } from '../../app/queries/query-policy'
import { createApiClient } from '../../app/utils/api-client'
import { coladaOptions } from '../../app/utils/colada-options'
import { ESI_QUERY_RETENTION_MS } from '../../packages/platform-module-nuxt/src/runtime/esi-query-persistence'
import { ApiQueryError } from '../../app/utils/query-error'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'
import { queryServer } from '../support/query-server'

const apiClient = createApiClient('http://localhost')
const allowed: ProtectedCharacterQueryAccess = {
  authenticated: true,
  authenticationReady: true,
  isClient: true,
  ownsCharacter: true,
}

describe('character Assets private query', () => {
  it('uses isolated hierarchical identities and the 24-hour persistence policy', () => {
    expect(PRIVATE_QUERY_KEYS.characterAssets(7)).toStrictEqual([
      'private',
      'characters',
      7,
      'assets',
    ])
    expect(PRIVATE_QUERY_KEYS.characterAssets(7)).not.toStrictEqual(
      PRIVATE_QUERY_KEYS.characterAssets(8),
    )
    expect(QUERY_POLICY.characterAssets.staleTime).toBe(60 * 60_000)
    expect(characterAssetsQuery({ access: allowed, apiClient, characterId: 7 }).gcTime).toBe(
      ESI_QUERY_RETENTION_MS,
    )
  })

  it('requires browser execution, authentication, exact ownership, and a positive safe ID', () => {
    expect(canRunProtectedCharacterQuery(allowed, 7)).toBe(true)
    expect(canRunProtectedCharacterQuery({ ...allowed, isClient: false }, 7)).toBe(false)
    expect(canRunProtectedCharacterQuery({ ...allowed, authenticationReady: false }, 7)).toBe(false)
    expect(canRunProtectedCharacterQuery({ ...allowed, authenticated: false }, 7)).toBe(false)
    expect(canRunProtectedCharacterQuery({ ...allowed, ownsCharacter: false }, 7)).toBe(false)
    for (const id of [0, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(canRunProtectedCharacterQuery(allowed, id)).toBe(false)
    }
  })

  it('does not issue the protected request during server rendering', async () => {
    const fetchRequest = vi.spyOn(globalThis, 'fetch')
    const Root = defineComponent({
      setup() {
        useQuery(
          characterAssetsQuery({
            access: { ...allowed, isClient: false },
            apiClient,
            characterId: 7,
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
          ...characterAssetsQuery({ access: allowed, apiClient, characterId: 7 }),
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
    expect(error).toMatchObject({ code: 'ASSETS_IDENTITY_MISMATCH', status: 409 })
    wrapper.unmount()
  })

  it('maps non-200 responses through the API error contract', async () => {
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/assets', () =>
        HttpResponse.json(
          {
            authorizeUrl: '/reauthorize/7',
            code: 'EVE_SCOPE_REQUIRED',
            message: 'Grant asset access.',
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
          ...characterAssetsQuery({ access: allowed, apiClient, characterId: 7 }),
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
      authorizeUrl: '/reauthorize/7',
      code: 'EVE_SCOPE_REQUIRED',
      message: 'Grant asset access.',
      requiredScope: 'esi-assets.read_assets.v1',
      status: 403,
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
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.session())).toStrictEqual(
      unauthenticatedSession,
    )
    wrapper.unmount()
  })
})

function assetResponse(characterId: number) {
  return {
    assets: [],
    cachedUntil: '2026-09-03T13:00:00.000Z',
    characterId,
    enrichment: { locations: 'complete', names: 'complete', types: 'complete' },
    stale: false,
    validatedAt: '2026-09-03T12:00:00.000Z',
  }
}
