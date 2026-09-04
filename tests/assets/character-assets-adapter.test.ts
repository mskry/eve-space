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
  itemId: 10,
  typeId: 100,
  typeName: 'Secure Container',
  groupId: 12,
  groupName: 'Cargo Container',
  categoryId: 65,
  categoryName: 'Structure',
  unitVolume: 1.5,
  totalVolume: 1.5,
  quantity: 1,
  isSingleton: true,
  isBlueprintCopy: null,
  customName: null as string | null,
  locationId: 123,
  locationType: 'station' as const,
  locationName: 'Jita IV - Moon 4',
  locationFlag: 'Hangar',
  parentItemId: null,
}

describe('character Assets mapper', () => {
  it('strips source identity and preserves every nullable, unknown, and enrichment field', () => {
    const mapped = mapCharacterAssets({
      characterId: 7,
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
          locationFlag: 'FutureFlag',
          parentItemId: null,
        },
      ],
      enrichment: { types: 'unavailable', names: 'partial', locations: 'complete' },
      cachedUntil: '2026-09-03T13:00:00.000Z',
      validatedAt: '2026-09-03T12:00:00.000Z',
      stale: true,
      refreshFailureClass: 'esi-unavailable',
      retryAt: null,
    })

    expect(mapped).toEqual({
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
          locationFlag: 'FutureFlag',
          parentItemId: null,
        },
      ],
      enrichment: { types: 'unavailable', names: 'partial', locations: 'complete' },
      validatedAt: '2026-09-03T12:00:00.000Z',
      stale: true,
      refreshFailureClass: 'esi-unavailable',
      retryAt: null,
    })
    expect(mapped).not.toHaveProperty('characterId')
    expect(mapped).not.toHaveProperty('cachedUntil')
    expect(
      mapCharacterAssets({
        characterId: 7,
        assets: [],
        enrichment: { types: 'complete', names: 'complete', locations: 'complete' },
        cachedUntil: '2026-09-03T13:00:00.000Z',
        validatedAt: '2026-09-03T12:00:00.000Z',
        stale: false,
      }).refreshFailureClass,
    ).toBeNull()
  })

  it('treats the ESI unnamed sentinel as no custom name', () => {
    const mapped = mapCharacterAssets({
      characterId: 7,
      assets: [
        { ...sourceAsset, itemId: 1, customName: 'None' },
        { ...sourceAsset, itemId: 2, customName: '   ' },
        { ...sourceAsset, itemId: 4, customName: '&nbsp;' },
        { ...sourceAsset, itemId: 3, customName: '  Cargo vault  ' },
      ],
      enrichment: { types: 'complete', names: 'complete', locations: 'complete' },
      cachedUntil: '2026-09-03T13:00:00.000Z',
      validatedAt: '2026-09-03T12:00:00.000Z',
      stale: false,
      refreshFailureClass: null,
    })

    expect(mapped.assets.map((asset) => asset.customName)).toEqual([
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
        loading: false,
        error: new ApiQueryError('Grant access.', {
          status: 403,
          code: 'EVE_SCOPE_REQUIRED',
          authorizeUrl: '/reauthorize/7',
        }),
      }),
    ).toMatchObject({
      phase: 'access-required',
      canRetry: false,
      action: {
        href: '/reauthorize/7',
        label: 'AUTHORIZE ASSETS FOR THIS CHARACTER',
      },
    })
    expect(
      mapCharacterAssetsResourceState({
        data: null,
        loading: false,
        error: new ApiQueryError('Authorization rejected.', {
          status: 401,
          code: 'EVE_REAUTH_REQUIRED',
          authorizeUrl: '/reauthorize/7',
        }),
      }),
    ).toMatchObject({
      phase: 'authorization-rejected',
      canRetry: false,
      action: {
        href: '/reauthorize/7',
        label: 'AUTHORIZE ASSETS FOR THIS CHARACTER',
      },
    })
    expect(
      mapCharacterAssetsResourceState({
        data: null,
        loading: false,
        error: new ApiQueryError('Cooling down.', {
          status: 429,
          code: 'ESI_COOLDOWN',
          retryAfterSeconds: 30,
          retryAt: '2026-09-03T12:00:30.000Z',
        }),
      }),
    ).toMatchObject({
      phase: 'cooldown',
      message: 'Cooling down. Retry after 30 seconds.',
      canRetry: false,
      retryAt: '2026-09-03T12:00:30.000Z',
    })
    expect(
      mapCharacterAssetsResourceState({
        data: null,
        loading: false,
        error: new Error(''),
      }),
    ).toMatchObject({
      phase: 'unavailable',
      message: 'This character asset collection is temporarily unavailable.',
      canRetry: true,
    })
    expect(
      mapCharacterAssetsResourceState({
        data: {
          assets: [],
          enrichment: { types: 'complete', names: 'complete', locations: 'complete' },
          stale: true,
          validatedAt: '2026-09-03T12:00:00.000Z',
          refreshFailureClass: 'esi-unavailable',
          retryAt: null,
        },
        loading: false,
        error: new Error('Refresh failed.'),
      }),
    ).toMatchObject({
      phase: 'ready',
      refreshFailed: true,
      stale: true,
      message: 'Refresh failed.',
      canRetry: true,
    })
    expect(
      mapCharacterAssetsResourceState({
        data: {
          assets: [],
          enrichment: { types: 'complete', names: 'complete', locations: 'complete' },
          stale: true,
          validatedAt: '2026-09-03T12:00:00.000Z',
          refreshFailureClass: 'esi-cooldown',
          retryAt: '2026-09-03T12:00:30.000Z',
        },
        loading: false,
        error: null,
      }),
    ).toMatchObject({
      phase: 'ready',
      stale: true,
      canRetry: false,
      retryAt: '2026-09-03T12:00:30.000Z',
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
    expect(requestedIds).toEqual([7])
    expect(mounted.adapter.assets.value?.assets[0]?.itemId).toBe(70)

    mounted.characterId.value = 8
    await settle()
    expect(requestedIds).toEqual([7])

    mounted.characters.value = [{ characterId: 7 }, { characterId: 8 }]
    await settle()
    expect(requestedIds).toEqual([7, 8])
    expect(mounted.adapter.assets.value?.assets[0]?.itemId).toBe(80)

    mounted.authenticated.value = false
    mounted.characterId.value = 9
    mounted.characters.value = [{ characterId: 9 }]
    await settle()
    expect(requestedIds).toEqual([7, 8])
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
      phase: 'ready',
      refreshFailed: true,
      message: 'Refresh failed.',
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
})

function mountAdapter(
  registerReauthorization: (
    id: ReturnType<typeof computed<number | undefined>>,
    onSuccess: () => void,
  ) => void = () => {},
) {
  const state = {} as {
    authenticated: ReturnType<typeof ref<boolean>>
    characterId: ReturnType<typeof ref<number | undefined>>
    characters: ReturnType<typeof ref<Array<{ characterId: number }>>>
    adapter: ReturnType<typeof useCharacterAssets>
  }
  const Host = defineComponent({
    setup() {
      state.authenticated = ref(true)
      state.characterId = ref<number | undefined>(7)
      state.characters = ref([{ characterId: 7 }])
      state.adapter = useCharacterAssets({
        apiClient: createApiClient('http://localhost'),
        authenticated: state.authenticated,
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
    characterId,
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
        locationId: 60003760,
        locationType: 'station',
        locationName: 'Jita IV - Moon 4',
        locationFlag: 'Hangar',
        parentItemId: null,
      },
    ],
    enrichment: { types: 'complete', names: 'complete', locations: 'complete' },
    cachedUntil: '2026-09-03T13:00:00.000Z',
    validatedAt: '2026-09-03T12:00:00.000Z',
    stale: false,
  }
}
