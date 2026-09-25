import { flushPromises } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useCharacterAssets } from '../../app/composables/useCharacterAssets'
import { createApiClient } from '../../app/utils/api-client'
import {
  mapCharacterAssets,
  mapCharacterAssetsResourceState,
} from '../../app/utils/character-assets-mapper'
import { ApiQueryError } from '../../app/utils/query-error'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'
import { queryServer } from '../support/query-server'

const sourceAsset = {
  categoryId: 65,
  categoryName: 'Structure',
  customName: null as string | null,
  groupId: 12,
  groupName: 'Cargo Container',
  isBlueprintCopy: null,
  isSingleton: true,
  itemId: 10,
  locationFlag: 'Hangar',
  locationId: 123,
  locationName: 'Jita IV - Moon 4',
  locationType: 'station' as const,
  parentItemId: null,
  quantity: 1,
  solarSystemId: 30_000_142,
  solarSystemSecurityStatus: 0.9,
  totalVolume: 1.5,
  typeId: 100,
  typeName: 'Secure Container',
  unitVolume: 1.5,
}

describe('character Assets mapper', () => {
  it('strips source identity and preserves every nullable, unknown, and enrichment field', () => {
    const mapped = mapCharacterAssets({
      assets: [
        {
          itemId: 10,
          typeId: 999,
          typeName: 'Unknown type 999',
          groupId: null,
          groupName: null,
          categoryId: null,
          categoryName: null,
          unitVolume: null,
          totalVolume: null,
          quantity: 1,
          isSingleton: true,
          isBlueprintCopy: null,
          customName: null,
          locationId: 123,
          locationType: 'other',
          locationName: null,
          solarSystemId: null,
          solarSystemSecurityStatus: null,
          locationFlag: 'FutureFlag',
          parentItemId: null,
        },
      ],
      cachedUntil: '2026-09-03T13:00:00.000Z',
      characterId: 7,
      enrichment: { locations: 'complete', names: 'partial', types: 'unavailable' },
      refreshFailureClass: 'esi-unavailable',
      retryAt: null,
      stale: true,
      validatedAt: '2026-09-03T12:00:00.000Z',
    })

    expect(mapped).toStrictEqual({
      assets: [
        {
          itemId: 10,
          typeId: 999,
          typeName: 'Unknown type 999',
          groupId: null,
          groupName: null,
          categoryId: null,
          categoryName: null,
          unitVolume: null,
          totalVolume: null,
          quantity: 1,
          isSingleton: true,
          isBlueprintCopy: null,
          customName: null,
          locationId: 123,
          locationType: 'other',
          locationName: null,
          solarSystemId: null,
          solarSystemSecurityStatus: null,
          locationFlag: 'FutureFlag',
          parentItemId: null,
        },
      ],
      enrichment: { locations: 'complete', names: 'partial', types: 'unavailable' },
      refreshFailureClass: 'esi-unavailable',
      retryAt: null,
      stale: true,
      validatedAt: '2026-09-03T12:00:00.000Z',
    })
    expect(mapped).not.toHaveProperty('characterId')
    expect(mapped).not.toHaveProperty('cachedUntil')
    expect(
      mapCharacterAssets({
        assets: [],
        cachedUntil: '2026-09-03T13:00:00.000Z',
        characterId: 7,
        enrichment: { locations: 'complete', names: 'complete', types: 'complete' },
        stale: false,
        validatedAt: '2026-09-03T12:00:00.000Z',
      }).refreshFailureClass,
    ).toBeNull()
  })

  it('treats the ESI unnamed sentinel as no custom name', () => {
    const mapped = mapCharacterAssets({
      assets: [
        { ...sourceAsset, itemId: 1, customName: 'None' },
        { ...sourceAsset, itemId: 2, customName: '   ' },
        { ...sourceAsset, itemId: 4, customName: '&nbsp;' },
        { ...sourceAsset, itemId: 3, customName: '  Cargo vault  ' },
      ],
      cachedUntil: '2026-09-03T13:00:00.000Z',
      characterId: 7,
      enrichment: { locations: 'complete', names: 'complete', types: 'complete' },
      refreshFailureClass: null,
      stale: false,
      validatedAt: '2026-09-03T12:00:00.000Z',
    })

    expect(mapped.assets.map((asset) => asset.customName)).toStrictEqual([
      null,
      null,
      null,
      'Cargo vault',
    ])
  })

  it('maps access, cooldown, unavailable, and retained refresh failures into display state', () => {
    expect(
      mapCharacterAssetsResourceState({
        data: null,
        error: new ApiQueryError('Grant access.', {
          status: 403,
          code: 'EVE_SCOPE_REQUIRED',
          authorizeUrl: '/reauthorize/7',
        }),
        loading: false,
      }),
    ).toMatchObject({
      action: {
        href: '/reauthorize/7',
        label: 'AUTHORIZE ASSETS FOR THIS CHARACTER',
      },
      canRetry: false,
      phase: 'access-required',
    })
    expect(
      mapCharacterAssetsResourceState({
        data: null,
        error: new ApiQueryError('Authorization rejected.', {
          status: 401,
          code: 'EVE_REAUTH_REQUIRED',
          authorizeUrl: '/reauthorize/7',
        }),
        loading: false,
      }),
    ).toMatchObject({
      action: {
        href: '/reauthorize/7',
        label: 'AUTHORIZE ASSETS FOR THIS CHARACTER',
      },
      canRetry: false,
      phase: 'authorization-rejected',
    })
    expect(
      mapCharacterAssetsResourceState({
        data: null,
        error: new ApiQueryError('Cooling down.', {
          status: 429,
          code: 'ESI_COOLDOWN',
          retryAfterSeconds: 30,
          retryAt: '2026-09-03T12:00:30.000Z',
        }),
        loading: false,
      }),
    ).toMatchObject({
      canRetry: false,
      message: 'Cooling down. Retry after 30 seconds.',
      phase: 'cooldown',
      retryAt: '2026-09-03T12:00:30.000Z',
    })
    expect(
      mapCharacterAssetsResourceState({
        data: null,
        error: new Error(''),
        loading: false,
      }),
    ).toMatchObject({
      canRetry: true,
      message: 'This character asset collection is temporarily unavailable.',
      phase: 'unavailable',
    })
    expect(
      mapCharacterAssetsResourceState({
        data: null,
        error: null,
        loading: false,
        parked: true,
      }),
    ).toMatchObject({
      canRetry: true,
      initialLoading: false,
      message: 'Character assets are not loaded. Retry to request them again.',
      phase: 'unavailable',
      refreshing: false,
      statusLabel: 'IDLE / ASSETS',
    })
    expect(
      mapCharacterAssetsResourceState({
        data: {
          assets: [],
          enrichment: { locations: 'complete', names: 'complete', types: 'complete' },
          refreshFailureClass: 'esi-unavailable',
          retryAt: null,
          stale: true,
          validatedAt: '2026-09-03T12:00:00.000Z',
        },
        error: new Error('Refresh failed.'),
        loading: false,
      }),
    ).toMatchObject({
      canRetry: true,
      message: 'Refresh failed.',
      phase: 'ready',
      refreshFailed: true,
      stale: true,
    })
    expect(
      mapCharacterAssetsResourceState({
        data: {
          assets: [],
          enrichment: { locations: 'complete', names: 'complete', types: 'complete' },
          refreshFailureClass: 'esi-cooldown',
          retryAt: '2026-09-03T12:00:30.000Z',
          stale: true,
          validatedAt: '2026-09-03T12:00:00.000Z',
        },
        error: null,
        loading: false,
      }),
    ).toMatchObject({
      canRetry: false,
      phase: 'ready',
      retryAt: '2026-09-03T12:00:30.000Z',
      stale: true,
    })
  })
})

describe('character Assets adapter', () => {
  it('gates requests by live roster state and follows character switches', async () => {
    const requestedIds: number[] = []
    queryServer.use(
      http.get('http://localhost/api/me/characters/:characterId/assets', ({ params }) => {
        const characterId = Number(params.characterId)
        requestedIds.push(characterId)
        return HttpResponse.json(response(characterId))
      }),
    )
    const mounted = mountAdapter()
    await settle()
    expect(requestedIds).toStrictEqual([7])
    expect(mounted.adapter.assets.value?.assets[0]?.itemId).toBe(70)

    mounted.characterId.value = 8
    await settle()
    expect(requestedIds).toStrictEqual([7])

    mounted.characters.value = [{ characterId: 7 }, { characterId: 8 }]
    await settle()
    expect(requestedIds).toStrictEqual([7, 8])
    expect(mounted.adapter.assets.value?.assets[0]?.itemId).toBe(80)

    mounted.authenticated.value = false
    mounted.characterId.value = 9
    mounted.characters.value = [{ characterId: 9 }]
    await settle()
    expect(requestedIds).toStrictEqual([7, 8])
    mounted.unmount()
  })

  it('keeps retained data when a refresh fails', async () => {
    let calls = 0
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/assets', () => {
        calls += 1
        return calls === 1
          ? HttpResponse.json(response(7))
          : HttpResponse.json(
              { code: 'ESI_UNAVAILABLE', message: 'Refresh failed.' },
              { status: 502 },
            )
      }),
    )
    const mounted = mountAdapter()
    await settle()
    await mounted.adapter.refreshAssets()
    await settle()

    expect(mounted.adapter.assets.value?.assets[0]?.itemId).toBe(70)
    expect(mounted.adapter.state.value).toMatchObject({
      message: 'Refresh failed.',
      phase: 'ready',
      refreshFailed: true,
    })
    mounted.unmount()
  })

  it('refreshes only the mounted Assets request after exact-identity reauthorization', async () => {
    let requests = 0
    let onSuccess: (() => void) | undefined
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/assets', () => {
        requests += 1
        return HttpResponse.json(response(7))
      }),
    )
    const mounted = mountAdapter((_id, callback) => {
      onSuccess = callback
    })
    await settle()
    expect(requests).toBe(1)

    onSuccess?.()
    await settle()
    expect(requests).toBe(2)
    mounted.unmount()
  })

  it('recalculates route jumps for origin changes without affecting retained assets on failure', async () => {
    const requestedOrigins: number[] = []
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/assets', () => HttpResponse.json(response(7))),
      http.post('http://localhost/api/universe/routes', async ({ request }) => {
        const body = (await request.json()) as {
          originSystemId: number
          destinationSystemIds: number[]
        }
        requestedOrigins.push(body.originSystemId)
        if (body.originSystemId === 30_000_143) {
          return HttpResponse.json(
            { code: 'UNIVERSE_TOPOLOGY_UNAVAILABLE', message: 'Routes unavailable.' },
            { status: 503 },
          )
        }
        return HttpResponse.json({
          originSystemId: body.originSystemId,
          policy: { kind: 'shortest' },
          routes: body.destinationSystemIds.map((destinationSystemId) => ({
            destinationSystemId,
            jumps: 0,
          })),
          sdeBuildNumber: 1234,
        })
      }),
    )
    const mounted = mountAdapter()
    mounted.characters.value = [{ characterId: 7, location: { solarSystemId: 30_000_142 } }]
    await settle()

    expect(requestedOrigins).toStrictEqual([30_000_142])
    expect(mounted.adapter.routeJumpsBySystemId.value.get(30_000_142)).toBe(0)

    mounted.characters.value = [{ characterId: 7, location: { solarSystemId: 30_000_143 } }]
    await settle()

    expect(requestedOrigins).toStrictEqual([30_000_142, 30_000_143])
    expect(mounted.adapter.assets.value?.assets[0]?.itemId).toBe(70)
    expect(mounted.adapter.state.value.phase).toBe('ready')
    expect(mounted.adapter.routeJumpsBySystemId.value.size).toBe(0)
    mounted.unmount()
  })
})

interface AssetAdapterFixtureState {
  authenticated: ReturnType<typeof ref<boolean>>
  authenticationReady: ReturnType<typeof ref<boolean>>
  characterId: ReturnType<typeof ref<number | undefined>>
  characters: ReturnType<
    typeof ref<Array<{ characterId: number; location?: { solarSystemId: number } | null }>>
  >
  adapter: ReturnType<typeof useCharacterAssets>
}

function mountAdapter(
  registerReauthorization: (
    id: ReturnType<typeof computed<number | undefined>>,
    onSuccess: () => void,
  ) => void = () => {},
) {
  const state = {} as AssetAdapterFixtureState
  const Host = defineComponent({
    setup() {
      state.authenticated = ref(true)
      state.authenticationReady = ref(true)
      state.characterId = ref<number | undefined>(7)
      state.characters = ref([{ characterId: 7 }])
      state.adapter = useCharacterAssets({
        apiClient: createApiClient('http://localhost'),
        authenticated: state.authenticated,
        authenticationReady: state.authenticationReady,
        characterId: computed(() => state.characterId.value),
        characters: state.characters,
        isClient: true,
        registerReauthorization,
      })
      return () => h('span')
    },
  })
  const { wrapper } = mountWithQueryPlugins(Host)
  return { ...state, unmount: () => wrapper.unmount() }
}

async function settle() {
  await nextTick()
  await flushPromises()
  await nextTick()
}

function response(characterId: number) {
  return {
    assets: [
      {
        itemId: characterId * 10,
        typeId: 34,
        typeName: 'Tritanium',
        groupId: 18,
        groupName: 'Mineral',
        categoryId: 4,
        categoryName: 'Material',
        unitVolume: 0.01,
        totalVolume: 1,
        quantity: 100,
        isSingleton: false,
        isBlueprintCopy: null,
        customName: null,
        locationId: 60_003_760,
        locationType: 'station',
        locationName: 'Jita IV - Moon 4',
        solarSystemId: 30_000_142,
        solarSystemSecurityStatus: 0.9,
        locationFlag: 'Hangar',
        parentItemId: null,
      },
    ],
    cachedUntil: '2026-09-03T13:00:00.000Z',
    characterId,
    enrichment: { locations: 'complete', names: 'complete', types: 'complete' },
    stale: false,
    validatedAt: '2026-09-03T12:00:00.000Z',
  }
}
