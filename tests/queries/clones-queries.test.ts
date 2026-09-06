import { PiniaColada, useQuery } from '@pinia/colada'
import { flushPromises } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { createPinia } from 'pinia'
import { createSSRApp, defineComponent, h, nextTick, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it, vi } from 'vitest'
import {
  canRunCharacterClonesQuery,
  characterClonesQuery,
  characterImplantsQuery,
} from '../../app/queries/clones'
import { clearAuthenticatedQueries, removeCharacterQueries } from '../../app/queries/query-cache'
import { PRIVATE_QUERY_KEYS } from '../../app/queries/query-keys'
import { QUERY_POLICY } from '../../app/queries/query-policy'
import { createApiClient } from '../../app/utils/api-client'
import { coladaOptions } from '../../app/utils/colada-options'
import { ApiQueryError } from '../../app/utils/query-error'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'
import { queryServer } from '../support/query-server'

const apiClient = createApiClient('http://localhost')
const allowed = { isClient: true, authenticated: true, ownsCharacter: true }
const freshness = {
  cachedUntil: '2026-09-03T11:02:00.000Z',
  validatedAt: '2026-09-03T11:00:00.000Z',
  stale: false,
}

describe('character clone queries', () => {
  it('uses isolated hierarchical keys and two-minute memory policies', () => {
    const clones = characterClonesQuery({ apiClient, characterId: 7, access: allowed })
    const implants = characterImplantsQuery({ apiClient, characterId: 7, access: allowed })

    expect(clones.key).toEqual(['private', 'characters', 7, 'clones'])
    expect(implants.key).toEqual(['private', 'characters', 7, 'implants'])
    expect(clones.key).not.toEqual(implants.key)
    expect(PRIVATE_QUERY_KEYS.characterClones(7)).not.toEqual(PRIVATE_QUERY_KEYS.characterClones(8))
    expect(PRIVATE_QUERY_KEYS.characterImplants(7)).not.toEqual(
      PRIVATE_QUERY_KEYS.characterImplants(8),
    )
    expect(QUERY_POLICY.characterClones.staleTime).toBe(120_000)
    expect(QUERY_POLICY.characterImplants.staleTime).toBe(120_000)
    expect(clones.gcTime).toBe(QUERY_POLICY.characterClones.gcTime)
    expect(implants.gcTime).toBe(QUERY_POLICY.characterImplants.gcTime)
  })

  it.each([
    [{ ...allowed, isClient: false }, 7],
    [{ ...allowed, authenticated: false }, 7],
    [{ ...allowed, ownsCharacter: false }, 7],
    [allowed, 0],
    [allowed, -1],
    [allowed, 1.5],
    [allowed, Number.MAX_SAFE_INTEGER + 1],
  ])('keeps both resources disabled for access %j and character ID %s', (access, characterId) => {
    expect(canRunCharacterClonesQuery(access, characterId)).toBe(false)
    expect(characterClonesQuery({ apiClient, characterId, access }).enabled).toBe(false)
    expect(characterImplantsQuery({ apiClient, characterId, access }).enabled).toBe(false)
  })

  it('loads both inferred DTOs independently and preserves stale metadata', async () => {
    const clones = cloneResponse('Jita IV - Moon 4', true)
    const implants = implantResponse('Memory Augmentation')
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/clones', () => HttpResponse.json(clones)),
      http.get('http://localhost/api/me/characters/7/implants', () => HttpResponse.json(implants)),
    )

    await expect(
      runQuery(characterClonesQuery({ apiClient, characterId: 7, access: allowed })),
    ).resolves.toEqual(clones)
    await expect(
      runQuery(characterImplantsQuery({ apiClient, characterId: 7, access: allowed })),
    ).resolves.toEqual(implants)
  })

  it('maps one resource error without preventing the other resource', async () => {
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/clones', () =>
        HttpResponse.json(
          {
            code: 'EVE_SCOPE_REQUIRED',
            message: 'Authorize clone access.',
            requiredScope: 'esi-clones.read_clones.v1',
            authorizeUrl: 'http://localhost/auth/eve/reauthorize/7',
          },
          { status: 403 },
        ),
      ),
      http.get('http://localhost/api/me/characters/7/implants', () =>
        HttpResponse.json(implantResponse('Ocular Filter')),
      ),
    )

    const [clones, implants] = await Promise.allSettled([
      runQuery(characterClonesQuery({ apiClient, characterId: 7, access: allowed })),
      runQuery(characterImplantsQuery({ apiClient, characterId: 7, access: allowed })),
    ])

    expect(clones.status).toBe('rejected')
    expect(clones.status === 'rejected' ? clones.reason : null).toMatchObject({
      status: 403,
      code: 'EVE_SCOPE_REQUIRED',
      requiredScope: 'esi-clones.read_clones.v1',
    })
    expect(clones.status === 'rejected' ? clones.reason : null).toBeInstanceOf(ApiQueryError)
    expect(implants).toMatchObject({ status: 'fulfilled' })
  })

  it('collapses duplicate consumers for both resources', async () => {
    const cloneRequests = vi.fn()
    const implantRequests = vi.fn()
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/clones', () => {
        cloneRequests()
        return HttpResponse.json(cloneResponse('Jita IV - Moon 4'))
      }),
      http.get('http://localhost/api/me/characters/7/implants', () => {
        implantRequests()
        return HttpResponse.json(implantResponse('Memory Augmentation'))
      }),
    )
    const Consumer = defineComponent({
      setup() {
        const clones = useQuery(
          characterClonesQuery({ apiClient, characterId: 7, access: allowed }),
        )
        const implants = useQuery(
          characterImplantsQuery({ apiClient, characterId: 7, access: allowed }),
        )
        return () =>
          h(
            'span',
            `${clones.data.value?.jumpClones.length ?? 0}:${implants.data.value?.implants.length ?? 0}`,
          )
      },
    })
    const Root = defineComponent({ setup: () => () => h('div', [h(Consumer), h(Consumer)]) })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(cloneRequests).toHaveBeenCalledOnce()
    expect(implantRequests).toHaveBeenCalledOnce()
    expect(wrapper.text()).toBe('1:11:1')
    wrapper.unmount()
  })

  it('switches character keys without showing the previous clone state', async () => {
    queryServer.use(
      http.get('http://localhost/api/me/characters/:characterId/clones', ({ params }) =>
        HttpResponse.json(
          cloneResponse(params.characterId === '7' ? 'Seven Station' : 'Eight Station'),
        ),
      ),
    )
    const characterId = ref(7)
    const Root = defineComponent({
      setup() {
        const result = useQuery(() =>
          characterClonesQuery({ apiClient, characterId: characterId.value, access: allowed }),
        )
        return () => h('span', result.data.value?.homeLocation?.name ?? 'loading')
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()
    expect(wrapper.text()).toBe('Seven Station')

    characterId.value = 8
    await nextTick()
    expect(wrapper.text()).toBe('loading')
    await flushPromises()
    expect(wrapper.text()).toBe('Eight Station')
    wrapper.unmount()
  })

  it('removes clone state on character removal and clears it on logout', () => {
    const Root = defineComponent({ setup: () => () => h('span') })
    const { queryCache, wrapper } = mountWithQueryPlugins(Root)
    for (const characterId of [7, 8]) {
      const clones = characterClonesQuery({ apiClient, characterId, access: allowed })
      const implants = characterImplantsQuery({ apiClient, characterId, access: allowed })
      queryCache.ensure(clones)
      queryCache.ensure(implants)
      queryCache.setQueryData(clones.key, cloneResponse(String(characterId)))
      queryCache.setQueryData(implants.key, implantResponse(String(characterId)))
    }

    removeCharacterQueries(queryCache, 7)
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterClones(7))).toBeUndefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterImplants(7))).toBeUndefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterClones(8))).toBeDefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterImplants(8))).toBeDefined()

    clearAuthenticatedQueries(queryCache, { authenticated: false })
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterClones(8))).toBeUndefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterImplants(8))).toBeUndefined()
    wrapper.unmount()
  })

  it('keeps successful clone data in memory only', async () => {
    localStorage.clear()
    sessionStorage.clear()
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/clones', () =>
        HttpResponse.json(cloneResponse('Memory only')),
      ),
    )
    const Root = defineComponent({
      setup() {
        useQuery(characterClonesQuery({ apiClient, characterId: 7, access: allowed }))
        return () => h('span')
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(localStorage).toHaveLength(0)
    expect(sessionStorage).toHaveLength(0)
    wrapper.unmount()
  })

  it('issues no protected request during server rendering', async () => {
    const requests = vi.fn()
    queryServer.use(
      http.get('http://localhost/api/me/characters/:characterId/clones', requests),
      http.get('http://localhost/api/me/characters/:characterId/implants', requests),
    )
    const serverAccess = { ...allowed, isClient: false }
    const Root = defineComponent({
      setup() {
        useQuery(characterClonesQuery({ apiClient, characterId: 7, access: serverAccess }))
        useQuery(characterImplantsQuery({ apiClient, characterId: 7, access: serverAccess }))
        return () => h('span', 'clones locked')
      },
    })
    const app = createSSRApp(Root)
    app.use(createPinia())
    app.use(PiniaColada, coladaOptions)

    await expect(renderToString(app)).resolves.toContain('clones locked')
    expect(requests).not.toHaveBeenCalled()
  })
})

function cloneResponse(homeName: string, stale = false) {
  return {
    homeLocation: { locationId: 60_000_001, locationType: 'station' as const, name: homeName },
    jumpClones: [
      {
        jumpCloneId: 11,
        name: null,
        location: { locationId: 60_000_002, locationType: 'station' as const, name: null },
        implants: [],
      },
    ],
    lastCloneJumpAt: null,
    lastStationChangeAt: null,
    ...freshness,
    stale,
    ...(stale ? { refreshFailureClass: 'esi-unavailable' as const } : {}),
  }
}

function implantResponse(name: string) {
  return { implants: [{ typeId: 2, name }], ...freshness }
}

function runQuery<T>(options: { query: (context: never) => Promise<T> }) {
  return options.query({ signal: new AbortController().signal } as never)
}
