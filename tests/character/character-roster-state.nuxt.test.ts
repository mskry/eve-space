import { flushPromises } from '@vue/test-utils'
import { computed, defineComponent, h, ref, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCharacterRoster } from '../../app/composables/useCharacterRoster'
import { PRIVATE_QUERY_KEYS } from '../../app/queries/query-keys'
import { createApiClient } from '../../app/utils/api-client'
import { ApiQueryError } from '../../app/utils/query-error'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'

const characters = [character(7)]
const mountedWrappers: { unmount: () => void }[] = []

beforeEach(() => {
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useRoute', () => ({ query: {} }))
  vi.stubGlobal('useAuthSession', () => ({
    authConfig: ref({ attachUrl: '', configured: false, loginUrl: '' }),
    authLoading: ref(false),
    authSession: ref({ account: { userId: 'user-1' }, authenticated: true }),
    initializeAuth: vi.fn(),
  }))
})

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount()
  }
  vi.unstubAllGlobals()
})

describe('character roster state', () => {
  it('reports a parked roster as unavailable with retry copy instead of a spinner', async () => {
    const mounted = mountRoster()
    mounted.queryCache.setQueryData(PRIVATE_QUERY_KEYS.roster(), { characters })
    await flushPromises()

    expect(mounted.roster.rosterStatus.value).toBe('idle')
    expect(mounted.roster.rosterRetryPanel.value).toBeNull()

    const entry = mounted.queryCache.get(PRIVATE_QUERY_KEYS.roster())
    expect(entry).toBeDefined()
    mounted.queryCache.setEntryState(entry!, { data: undefined, error: null, status: 'pending' })

    expect(mounted.roster.rosterStatus.value).toBe('unavailable')
    expect(mounted.roster.rosterRetryPanel.value).toMatchObject({
      message: 'No character request is in flight. Retry to load your characters.',
      title: 'Character list not loaded',
    })
  })

  it('reserves error for a completed failed request and keeps its message', () => {
    const mounted = mountRoster()
    const entry = mounted.queryCache.get(PRIVATE_QUERY_KEYS.roster())
    expect(entry).toBeDefined()
    mounted.queryCache.setEntryState(entry!, {
      data: undefined,
      error: new ApiQueryError('Character roster is unavailable.', { status: 503 }),
      status: 'error',
    })

    expect(mounted.roster.rosterStatus.value).toBe('error')
    expect(mounted.roster.rosterRetryPanel.value).toMatchObject({
      message: 'Character roster is unavailable.',
      title: 'Characters unavailable',
    })
  })

  it('reports an in-flight request as loading rather than unavailable', () => {
    const mounted = mountRoster()
    const entry = mounted.queryCache.get(PRIVATE_QUERY_KEYS.roster())
    expect(entry).toBeDefined()
    entry!.asyncStatus.value = 'loading'

    expect(mounted.roster.rosterStatus.value).toBe('loading')
    expect(mounted.roster.rosterRetryPanel.value).toBeNull()
  })

  it('reports a retry in flight as loading instead of retaining the previous error', () => {
    const mounted = mountRoster()
    const entry = mounted.queryCache.get(PRIVATE_QUERY_KEYS.roster())
    expect(entry).toBeDefined()
    mounted.queryCache.setEntryState(entry!, {
      data: undefined,
      error: new ApiQueryError('Character roster is unavailable.', { status: 503 }),
      status: 'error',
    })
    entry!.asyncStatus.value = 'loading'

    expect(mounted.roster.rosterStatus.value).toBe('loading')
    expect(mounted.roster.rosterRetryPanel.value).toBeNull()
  })
})

function mountRoster() {
  let roster!: ReturnType<typeof useCharacterRoster>
  const Host = defineComponent({
    setup() {
      roster = useCharacterRoster(createApiClient('http://localhost'))
      return () => h('span')
    },
  })
  const { queryCache, wrapper } = mountWithQueryPlugins(Host)
  mountedWrappers.push(wrapper)
  return { queryCache, roster, wrapper }
}

function character(characterId: number) {
  return {
    alliance: null,
    allianceId: null,
    birthday: '2020-01-01T00:00:00.000Z',
    characterId,
    corporation: { id: 98_000_001, name: 'Corporation' },
    corporationId: 98_000_001,
    isMain: true,
    location: null,
    name: String(characterId),
    raceFactionId: 500_001,
    securityStatus: 1,
    ship: null,
    totalSp: 0,
    walletBalance: 0,
  }
}
