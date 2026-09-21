import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { RouterLinkStub } from '@vue/test-utils'
import { computed, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CharacterPage from '../../app/pages/characters/[characterId].vue'
import CharactersPage from '../../app/pages/characters/index.vue'
import { readQueryCharacterOwnership } from '../../app/query-persistence/runtime'

vi.mock('../../app/query-persistence/runtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../app/query-persistence/runtime')>()),
  readQueryCharacterOwnership: vi.fn(),
}))

const {
  createApiClient,
  currentRoute,
  loadCharacterRoster,
  refetchCharacterRoster,
  useAuthSession,
  useCharacterRecordNavigation,
  useCharacterRoster,
  useConfirmDialog,
} = vi.hoisted(() => ({
  createApiClient: vi.fn(() => ({})),
  currentRoute: {
    fullPath: '/characters/7',
    hash: '',
    meta: { title: 'Character' },
    params: { characterId: '7' },
    path: '/characters/7',
    query: {},
  },
  loadCharacterRoster: vi.fn(),
  refetchCharacterRoster: vi.fn(),
  useAuthSession: vi.fn(),
  useCharacterRecordNavigation: vi.fn(),
  useCharacterRoster: vi.fn(),
  useConfirmDialog: vi.fn(),
}))

mockNuxtImport('createApiClient', () => createApiClient)
mockNuxtImport('useAuthSession', () => useAuthSession)
mockNuxtImport('useCharacterRecordNavigation', () => useCharacterRecordNavigation)
mockNuxtImport('useCharacterRoster', () => useCharacterRoster)
mockNuxtImport('useConfirmDialog', () => useConfirmDialog)
mockNuxtImport('useRoute', () => () => currentRoute)

const authLoading = ref(false)
const authSession = ref({ authenticated: true })
const authUnavailable = ref(false)
const characters = ref<never[]>([])
const admissionOwnership = ref(false)
const rosterMessage = ref('')
const rosterRetryPanel = ref<{
  code: string
  message: string
  title: string
} | null>(null)
const rosterStatus = ref<'idle' | 'loading' | 'error' | 'unavailable'>('unavailable')
const mountedWrappers: { unmount: () => void }[] = []

beforeEach(() => {
  admissionOwnership.value = false
  vi.mocked(readQueryCharacterOwnership).mockReturnValue(computed(() => admissionOwnership.value))
  authLoading.value = false
  authSession.value = { authenticated: true }
  authUnavailable.value = false
  rosterMessage.value = ''
  rosterRetryPanel.value = {
    code: 'IDLE / CHARACTERS',
    message: 'No character request is in flight. Retry to load your characters.',
    title: 'Character list not loaded',
  }
  rosterStatus.value = 'unavailable'
  loadCharacterRoster.mockReset().mockResolvedValue(undefined)
  refetchCharacterRoster.mockReset().mockResolvedValue(undefined)
  useAuthSession.mockReturnValue({
    authLoading,
    authSession,
    authUnavailable,
    initializeAuth: vi.fn(),
    refreshAuthContext: vi.fn(),
  })
  useCharacterRoster.mockReturnValue({
    attachCharacter: vi.fn(),
    characters,
    deleteCharacterPending: ref(undefined),
    loadCharacterRoster,
    mainCharacterPending: ref(undefined),
    refetchCharacterRoster,
    removeCharacter: vi.fn(),
    rosterMessage,
    rosterRetryPanel,
    rosterStatus,
    selectMainCharacter: vi.fn(),
  })
  useCharacterRecordNavigation.mockReturnValue({
    breadcrumbLabel: ref(''),
    entries: ref([]),
    prefetchNavigation: vi.fn(),
  })
  useConfirmDialog.mockReturnValue({ openConfirmDialog: vi.fn() })
})

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  vi.clearAllMocks()
})

describe('character roster page states', () => {
  it('mounts the character route from admission while roster enrichment is pending', async () => {
    rosterRetryPanel.value = null
    rosterStatus.value = 'loading'
    const wrapper = await mountSuspended(CharacterPage, {
      route: false,
      global: {
        stubs: {
          NuxtLink: RouterLinkStub,
          NuxtPage: { template: '<div data-testid="character-child">Character detail</div>' },
        },
      },
    })
    mountedWrappers.push(wrapper)

    expect(wrapper.find('[data-testid="character-child"]').exists()).toBe(false)
    admissionOwnership.value = true
    await nextTick()
    expect(wrapper.find('[data-testid="character-child"]').exists()).toBe(true)
    expect(characters.value).toEqual([])
    expect(wrapper.text()).not.toContain('Resolving character authorization')
    admissionOwnership.value = false
    await nextTick()
    expect(wrapper.find('[data-testid="character-child"]').exists()).toBe(false)
  })

  it('renders the parked roster retry panel on the roster page', async () => {
    const wrapper = await mountSuspended(CharactersPage, {
      route: false,
      global: { stubs: { NuxtLink: RouterLinkStub } },
    })
    mountedWrappers.push(wrapper)

    expect(wrapper.get('[role="alert"] h2').text()).toBe('Character list not loaded')
    expect(wrapper.text()).not.toContain('Loading characters')
  })

  it('keeps an unavailable roster out of the character-not-found branch', async () => {
    const wrapper = await mountSuspended(CharacterPage, {
      route: false,
      global: { stubs: { NuxtLink: RouterLinkStub } },
    })
    mountedWrappers.push(wrapper)

    expect(wrapper.get('[role="alert"] h2').text()).toBe('Character list not loaded')
    expect(wrapper.text()).not.toContain('Character not found')

    rosterRetryPanel.value = null
    rosterStatus.value = 'idle'
    await nextTick()

    expect(wrapper.get('[role="alert"] h2').text()).toBe('Character not found')
  })
})
