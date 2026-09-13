import { http, HttpResponse } from 'msw'
import { flushPromises } from '@vue/test-utils'
import { computed, defineComponent, h, nextTick, ref, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthSession } from '../../app/composables/useAuthSession'
import { useCharacterRoster } from '../../app/composables/useCharacterRoster'
import { unauthenticatedSession } from '../../app/queries/auth'
import { PRIVATE_QUERY_KEYS } from '../../app/queries/query-keys'
import { createApiClient } from '../../app/utils/api-client'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'
import { queryServer } from '../support/query-server'

beforeEach(() => {
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useRoute', () => ({ query: {} }))
  vi.stubGlobal('useAuthSession', () => ({
    authConfig: ref({ configured: false, loginUrl: '', attachUrl: '' }),
    authSession: ref({ authenticated: false }),
    initializeAuth: vi.fn(),
  }))
  queryServer.use(
    http.get('http://localhost/auth/config', () =>
      HttpResponse.json({ configured: false, loginUrl: '', attachUrl: '' }),
    ),
    http.get('http://localhost/auth/session', () => HttpResponse.json(authenticatedSession())),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('private query lifecycle', () => {
  it('clears all private data when an observed authenticated session becomes anonymous', async () => {
    const Host = defineComponent({
      setup() {
        useAuthSession(createApiClient('http://localhost'))
        return () => h('span')
      },
    })
    const { queryCache, wrapper } = mountWithQueryPlugins(Host)
    const sessionEntry = queryCache.get(PRIVATE_QUERY_KEYS.session())
    expect(sessionEntry).toBeDefined()
    await queryCache.refresh(sessionEntry!)
    await flushPromises()
    await nextTick()
    seedCharacterQuery(queryCache, 7)
    queryCache.ensure({
      key: PRIVATE_QUERY_KEYS.organizationCompliance(),
      query: async () => ({ state: 'compliant' }),
    })
    queryCache.setQueryData(PRIVATE_QUERY_KEYS.organizationCompliance(), { state: 'compliant' })

    queryCache.setQueryData(PRIVATE_QUERY_KEYS.session(), unauthenticatedSession)
    await nextTick()

    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.session())).toEqual(unauthenticatedSession)
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterAssets(7))).toBeUndefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.organizationCompliance())).toBeUndefined()
    wrapper.unmount()
  })

  it('clears prior private data while preserving a newly authenticated user session', async () => {
    const Host = defineComponent({
      setup() {
        useAuthSession(createApiClient('http://localhost'))
        return () => h('span')
      },
    })
    const { queryCache, wrapper } = mountWithQueryPlugins(Host)
    const sessionEntry = queryCache.get(PRIVATE_QUERY_KEYS.session())
    expect(sessionEntry).toBeDefined()
    await queryCache.refresh(sessionEntry!)
    await flushPromises()
    await nextTick()
    seedCharacterQuery(queryCache, 7)
    queryCache.ensure({
      key: PRIVATE_QUERY_KEYS.organizationRoles(),
      query: async () => ({ grants: [] }),
    })
    queryCache.setQueryData(PRIVATE_QUERY_KEYS.organizationRoles(), { grants: [] })

    const nextSession = authenticatedSession('user-2', 8)
    queryCache.setQueryData(PRIVATE_QUERY_KEYS.session(), nextSession)
    await nextTick()

    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.session())).toEqual(nextSession)
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterAssets(7))).toBeUndefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.organizationRoles())).toBeUndefined()
    wrapper.unmount()
  })

  it('cancels and removes only characters lost from a refreshed roster', () => {
    const Host = defineComponent({
      setup() {
        useCharacterRoster(createApiClient('http://localhost'))
        return () => h('span')
      },
    })
    const { queryCache, wrapper } = mountWithQueryPlugins(Host)
    queryCache.setQueryData(PRIVATE_QUERY_KEYS.roster(), {
      characters: [character(7), character(8)],
    })
    seedCharacterQuery(queryCache, 7)
    seedCharacterQuery(queryCache, 8)

    queryCache.setQueryData(PRIVATE_QUERY_KEYS.roster(), { characters: [character(8)] })

    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterAssets(7))).toBeUndefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterAssets(8))).toBeDefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.roster())).toEqual({
      characters: [character(8)],
    })
    wrapper.unmount()
  })
})

function seedCharacterQuery(
  queryCache: ReturnType<typeof mountWithQueryPlugins>['queryCache'],
  characterId: number,
) {
  const key = PRIVATE_QUERY_KEYS.characterAssets(characterId)
  queryCache.ensure({ key, query: async () => ({ characterId }) })
  queryCache.setQueryData(key, { characterId })
}

function authenticatedSession(userId = 'user-1', characterId = 7) {
  return {
    authenticated: true as const,
    account: {
      userId,
      mainCharacter: { characterId, name: String(characterId) },
    },
  }
}

function character(characterId: number) {
  return {
    characterId,
    name: String(characterId),
    corporationId: 98_000_001,
    allianceId: null,
    isMain: characterId === 7,
    birthday: '2020-01-01T00:00:00.000Z',
    gender: 'Female',
    race: 'Caldari',
    bloodline: 'Deteis',
    securityStatus: 1,
    corporation: { id: 98_000_001, name: 'Corporation', ticker: 'CORP', memberCount: 1 },
    alliance: null,
    location: null,
    ship: null,
    skills: null,
  }
}
