import { useQuery } from '@pinia/colada'
import { flushPromises } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  characterAttributesQuery,
  characterHistoryQuery,
  characterOverviewQuery,
  characterSkillQueueQuery,
  characterSkillsQuery,
  type CharacterOverview,
} from '../app/queries/characters'
import { removeCharacterQueries } from '../app/queries/query-cache'
import { PRIVATE_QUERY_KEYS } from '../app/queries/query-keys'
import { walletQuery, walletTransactionsQuery } from '../app/queries/wallet'
import { createApiClient } from '../app/utils/api-client'
import { ApiQueryError } from '../app/utils/query-error'
import { mountWithQueryPlugins } from './support/mount-with-query-plugins'
import { queryServer } from './support/query-server'

describe('protected character queries', () => {
  it('deduplicates a shared character request', async () => {
    const requests = vi.fn()
    queryServer.use(
      http.get('http://localhost/api/me/characters/7', () => {
        requests()
        return HttpResponse.json(characterOverviewResponse(7, 'Seven'))
      }),
    )
    const apiClient = createApiClient('http://localhost')
    const Consumer = defineComponent({
      setup() {
        const { data } = useQuery(characterOverviewQuery({ apiClient, characterId: 7 }))
        return () => h('span', data.value?.profile.name ?? 'loading')
      },
    })
    const Root = defineComponent({ setup: () => () => h('div', [h(Consumer), h(Consumer)]) })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(requests).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toBe('SevenSeven')
    wrapper.unmount()
  })

  it('switches character keys without displaying the previous character as the next one', async () => {
    queryServer.use(
      http.get('http://localhost/api/me/characters/:characterId', ({ params }) => {
        const id = Number(params.characterId)
        return HttpResponse.json(characterOverviewResponse(id, id === 7 ? 'Seven' : 'Eight'))
      }),
    )
    const apiClient = createApiClient('http://localhost')
    const characterId = ref(7)
    const Root = defineComponent({
      setup() {
        const { data } = useQuery(() =>
          characterOverviewQuery({ apiClient, characterId: characterId.value }),
        )
        return () => h('span', data.value?.profile.name ?? 'loading')
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()
    expect(wrapper.text()).toBe('Seven')

    characterId.value = 8
    await nextTick()
    expect(wrapper.text()).toBe('loading')
    await flushPromises()
    expect(wrapper.text()).toBe('Eight')
    wrapper.unmount()
  })

  it('removes only the deleted character subtree', () => {
    const Root = defineComponent({ setup: () => () => h('span') })
    const { queryCache, wrapper } = mountWithQueryPlugins(Root)
    for (const characterId of [7, 8]) {
      const options = characterOverviewQuery({
        apiClient: createApiClient('http://localhost'),
        characterId,
      })
      queryCache.ensure(options)
      queryCache.setQueryData(
        options.key,
        characterOverviewResponse(characterId, String(characterId)),
      )
      const attributeOptions = characterAttributesQuery({
        apiClient: createApiClient('http://localhost'),
        characterId,
      })
      queryCache.ensure(attributeOptions)
      queryCache.setQueryData(attributeOptions.key, characterAttributesResponse())
      const historyOptions = characterHistoryQuery({
        apiClient: createApiClient('http://localhost'),
        characterId,
      })
      queryCache.ensure(historyOptions)
      queryCache.setQueryData(historyOptions.key, { characterId, history: [] })
      const transactionOptions = walletTransactionsQuery({
        apiClient: createApiClient('http://localhost'),
        characterId,
      })
      queryCache.ensure(transactionOptions)
      queryCache.setQueryData(transactionOptions.key, {
        characterId,
        transactions: [],
        cachedUntil: '2026-08-20T00:00:00.000Z',
        source: 'cache',
        stale: false,
        quota: {},
      })
      queryCache.ensure({
        key: PRIVATE_QUERY_KEYS.characterModuleResource(characterId, 'member-audit', 'records'),
        query: async () => ({ records: [] }),
      })
      queryCache.setQueryData(
        PRIVATE_QUERY_KEYS.characterModuleResource(characterId, 'member-audit', 'records'),
        { records: [] },
      )
    }

    removeCharacterQueries(queryCache, 7)

    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterOverview(7))).toBeUndefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterAttributes(7))).toBeUndefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterHistory(7))).toBeUndefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.walletTransactions(7))).toBeUndefined()
    expect(
      queryCache.getQueryData(
        PRIVATE_QUERY_KEYS.characterModuleResource(7, 'member-audit', 'records'),
      ),
    ).toBeUndefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterOverview(8))).toBeDefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterAttributes(8))).toBeDefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.characterHistory(8))).toBeDefined()
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.walletTransactions(8))).toBeDefined()
    expect(
      queryCache.getQueryData(
        PRIVATE_QUERY_KEYS.characterModuleResource(8, 'member-audit', 'records'),
      ),
    ).toBeDefined()
    wrapper.unmount()
  })

  it('keeps a successful stale wallet response and its retry metadata', async () => {
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/wallet', () =>
        HttpResponse.json({
          characterId: 7,
          balance: 123.45,
          cachedUntil: '2026-08-20T00:00:00.000Z',
          source: 'cache',
          stale: true,
          retryAt: '2026-08-20T00:01:00.000Z',
          quota: {},
        }),
      ),
    )
    const apiClient = createApiClient('http://localhost')
    const Root = defineComponent({
      setup() {
        const result = useQuery(walletQuery({ apiClient, characterId: 7 }))
        return () => h('span', result.data.value?.stale ? result.data.value.retryAt : 'loading')
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(wrapper.text()).toBe('2026-08-20T00:01:00.000Z')
    wrapper.unmount()
  })

  it('rejects a wallet response for a different selected character', async () => {
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/wallet', () =>
        HttpResponse.json({
          characterId: 8,
          balance: 123.45,
          cachedUntil: '2026-08-20T00:00:00.000Z',
          source: 'cache',
          stale: false,
          quota: {},
        }),
      ),
    )
    const apiClient = createApiClient('http://localhost')
    const queryError = ref<Error | null>(null)
    const Root = defineComponent({
      setup() {
        const result = useQuery({ ...walletQuery({ apiClient, characterId: 7 }), retry: 0 })
        return () => {
          queryError.value = result.error.value
          return h('span')
        }
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(queryError.value).toMatchObject({
      status: 409,
      code: 'WALLET_IDENTITY_MISMATCH',
    })
    wrapper.unmount()
  })

  it('does not request wallet transactions until explicitly enabled', async () => {
    const requests = vi.fn()
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/wallet/transactions', () => {
        requests()
        return HttpResponse.json({
          characterId: 7,
          transactions: [
            {
              transactionId: 1,
              date: '2026-08-20T00:00:00.000Z',
              typeId: 34,
              typeName: 'Tritanium',
              quantity: 5,
              unitPrice: 10,
              totalPrice: 50,
              isBuy: true,
              isPersonal: true,
              clientId: 90_000_001,
              locationId: 60_000_001,
            },
          ],
          cachedUntil: '2026-08-20T00:01:00.000Z',
          source: 'esi',
          stale: false,
          quota: {},
        })
      }),
    )
    const apiClient = createApiClient('http://localhost')
    const enabled = ref(false)
    const Root = defineComponent({
      setup() {
        const result = useQuery(() => ({
          ...walletTransactionsQuery({ apiClient, characterId: 7 }),
          enabled: enabled.value,
        }))
        return () => h('span', result.data.value?.transactions[0]?.typeName ?? 'not loaded')
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()
    expect(requests).not.toHaveBeenCalled()
    expect(wrapper.text()).toBe('not loaded')

    enabled.value = true
    await nextTick()
    await flushPromises()

    expect(requests).toHaveBeenCalledOnce()
    expect(wrapper.text()).toBe('Tritanium')
    wrapper.unmount()
  })

  it('loads employment history for the selected character', async () => {
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/history', () =>
        HttpResponse.json({
          characterId: 7,
          history: [
            {
              recordId: 1,
              startDate: '2020-01-01T00:00:00.000Z',
              isDeleted: false,
              corporation: { id: 10, name: 'Test Corporation' },
            },
          ],
        }),
      ),
    )
    const apiClient = createApiClient('http://localhost')
    const Root = defineComponent({
      setup() {
        const result = useQuery(characterHistoryQuery({ apiClient, characterId: 7 }))
        return () => h('span', result.data.value?.history[0]?.corporation.name ?? 'loading')
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(wrapper.text()).toBe('Test Corporation')
    wrapper.unmount()
  })

  it('loads character attributes for the selected character', async () => {
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/attributes', () =>
        HttpResponse.json(characterAttributesResponse()),
      ),
    )
    const apiClient = createApiClient('http://localhost')
    const Root = defineComponent({
      setup() {
        const result = useQuery(characterAttributesQuery({ apiClient, characterId: 7 }))
        return () => h('span', result.data.value?.intelligence ?? 'loading')
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(wrapper.text()).toBe('27')
    wrapper.unmount()
  })

  it('loads the skill queue for the selected character', async () => {
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/skill-queue', () =>
        HttpResponse.json({
          entries: [
            {
              queuePosition: 0,
              typeId: 3300,
              name: 'Gunnery',
              groupId: 255,
              groupName: 'Gunnery',
              finishedLevel: 5,
              levelStartSp: 256000,
              levelEndSp: 512000,
              trainingStartSp: 260000,
              startDate: '2026-08-29T12:00:00Z',
              finishDate: '2026-08-30T12:00:00Z',
              primaryAttribute: 'perception',
              secondaryAttribute: 'willpower',
            },
          ],
        }),
      ),
    )
    const apiClient = createApiClient('http://localhost')
    const Root = defineComponent({
      setup() {
        const result = useQuery(characterSkillQueueQuery({ apiClient, characterId: 7 }))
        return () => h('span', result.data.value?.entries[0]?.name ?? 'loading')
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(wrapper.text()).toBe('Gunnery')
    wrapper.unmount()
  })

  it('preserves scope and reauthorization fields for feature UI', async () => {
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/skills', () =>
        HttpResponse.json(
          {
            code: 'EVE_REAUTH_REQUIRED',
            message: 'Authorization expired.',
            requiredScope: 'esi-skills.read_skills.v1',
            authorizeUrl: 'http://localhost/auth/eve/reauthorize/7',
          },
          { status: 403 },
        ),
      ),
    )
    const apiClient = createApiClient('http://localhost')
    const error = ref<Error | null>(null)
    const Root = defineComponent({
      setup() {
        const result = useQuery({
          ...characterSkillsQuery({ apiClient, characterId: 7 }),
          retry: 0,
        })
        const currentError = computed(() => result.error.value)
        return () => {
          error.value = currentError.value
          return h('span')
        }
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(error.value).toBeInstanceOf(ApiQueryError)
    expect(error.value).toMatchObject({
      status: 403,
      code: 'EVE_REAUTH_REQUIRED',
      requiredScope: 'esi-skills.read_skills.v1',
      authorizeUrl: 'http://localhost/auth/eve/reauthorize/7',
    })
    wrapper.unmount()
  })

  it('does not persist completed private query data in browser storage', async () => {
    localStorage.clear()
    sessionStorage.clear()
    queryServer.use(
      http.get('http://localhost/api/me/characters/7', () =>
        HttpResponse.json(characterOverviewResponse(7, 'Private Character')),
      ),
    )
    const apiClient = createApiClient('http://localhost')
    const Root = defineComponent({
      setup() {
        useQuery(characterOverviewQuery({ apiClient, characterId: 7 }))
        return () => h('span')
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(localStorage).toHaveLength(0)
    expect(sessionStorage).toHaveLength(0)
    wrapper.unmount()
  })
})

function characterOverviewResponse(characterId: number, name: string): CharacterOverview {
  return {
    profile: {
      id: characterId,
      name,
      birthday: '2020-01-01T00:00:00.000Z',
      gender: 'Female',
      race: 'Caldari',
      raceFactionId: null,
      bloodline: 'Deteis',
      securityStatus: 1,
      achievementScore: 0,
      factionId: null,
      corporation: { id: 1, name: 'Corp', ticker: 'CORP', memberCount: 1 },
      alliance: null,
    },
    location: { status: 'unavailable', message: 'Unavailable' },
    ship: { status: 'unavailable', message: 'Unavailable' },
    skills: { status: 'unavailable', message: 'Unavailable' },
  }
}

function characterAttributesResponse() {
  return {
    charisma: 19,
    intelligence: 27,
    memory: 23,
    perception: 24,
    willpower: 21,
    bonusRemaps: 2,
    accruedRemapCooldownDate: '2026-10-01T12:00:00Z',
    lastRemapDate: '2025-10-01T12:00:00Z',
  }
}
