import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SkillsPage from '../../app/pages/characters/[characterId]/skills.vue'
import { canRunProtectedCharacterQuery } from '../../app/queries/protected-character-query-access'

vi.mock('../../app/queries/protected-character-query-access', () => ({
  canRunProtectedCharacterQuery: vi.fn(
    (
      access: {
        authenticated: boolean
        authenticationReady: boolean
        ownsCharacter: boolean
      },
      requestedCharacterId: number,
    ) =>
      access.authenticated &&
      access.authenticationReady &&
      access.ownsCharacter &&
      requestedCharacterId > 0,
  ),
}))

const {
  attributesRequest,
  createApiClient,
  currentRoute,
  skillQueueRequest,
  skillsRequest,
  useAuthSession,
  useCharacterReauthorization,
  useCharacterRoster,
} = vi.hoisted(() => ({
  attributesRequest: vi.fn(),
  createApiClient: vi.fn(),
  currentRoute: { params: { characterId: '7' }, query: {} },
  skillQueueRequest: vi.fn(),
  skillsRequest: vi.fn(),
  useAuthSession: vi.fn(),
  useCharacterReauthorization: vi.fn(),
  useCharacterRoster: vi.fn(),
}))

mockNuxtImport('createApiClient', () => createApiClient)
mockNuxtImport('useAuthSession', () => useAuthSession)
mockNuxtImport('useCharacterReauthorization', () => useCharacterReauthorization)
mockNuxtImport('useCharacterRoster', () => useCharacterRoster)
mockNuxtImport('useRoute', () => () => currentRoute)

const characterId = 7
const authenticationLoading = ref(true)
const characters = ref<{ characterId: number }[]>([])
const mountedWrappers: { unmount: () => void }[] = []
let reauthorizationCallback: (() => void) | undefined

beforeEach(() => {
  authenticationLoading.value = true
  characters.value = []
  attributesRequest.mockImplementation(() => Promise.resolve(Response.json(attributesResponse())))
  skillsRequest.mockImplementation(() => Promise.resolve(Response.json(skillsResponse())))
  skillQueueRequest.mockImplementation(() => Promise.resolve(Response.json(skillQueueResponse())))
  createApiClient.mockReturnValue({
    api: {
      me: {
        characters: {
          ':characterId': {
            attributes: { $get: attributesRequest },
            'skill-queue': { $get: skillQueueRequest },
            skills: { $get: skillsRequest },
          },
        },
      },
    },
  })
  useAuthSession.mockReturnValue({
    authLoading: authenticationLoading,
    authSession: ref({ authenticated: false }),
  })
  useCharacterReauthorization.mockImplementation((_characterId: unknown, onSuccess: () => void) => {
    reauthorizationCallback = onSuccess
  })
  useCharacterRoster.mockReturnValue({ characters })
})

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount()
  }
  vi.clearAllMocks()
})

describe('character skills route behavior', () => {
  it('gates every protected request and refetches all three after reauthorization', async () => {
    const authSession = ref({ authenticated: true })
    authenticationLoading.value = true
    characters.value = [{ characterId }]
    useAuthSession.mockReturnValue({ authLoading: authenticationLoading, authSession })
    const wrapper = await mountSuspended(SkillsPage, { route: false })
    mountedWrappers.push(wrapper)
    expect(createApiClient).toHaveBeenCalled()
    expect(useAuthSession).toHaveBeenCalled()
    expect(useCharacterRoster).toHaveBeenCalled()
    expect(canRunProtectedCharacterQuery).toHaveBeenCalled()
    expect(vi.mocked(canRunProtectedCharacterQuery).mock.calls.at(-1)).toStrictEqual([
      {
        authenticated: true,
        authenticationReady: false,
        isClient: true,
        ownsCharacter: true,
      },
      characterId,
    ])
    await flushPromises()
    expect(protectedRequestCounts()).toStrictEqual([0, 0, 0])

    authenticationLoading.value = false
    await vi.waitFor(() => expect(protectedRequestCounts()).toStrictEqual([1, 1, 1]))
    expect(wrapper.text()).toContain('CHARACTER SKILLS')
    expect(wrapper.text()).toContain('Training Queue')

    expect(reauthorizationCallback).toBeTypeOf('function')
    reauthorizationCallback!()
    await vi.waitFor(() => expect(protectedRequestCounts()).toStrictEqual([2, 2, 2]))
  })
})

function protectedRequestCounts() {
  return [skillsRequest, attributesRequest, skillQueueRequest].map(
    (request) => request.mock.calls.length,
  )
}

function skillsResponse() {
  return {
    groups: [],
    injectedSkillCount: 0,
    totalSp: 1_500_000,
    unallocatedSp: 0,
  }
}

function attributesResponse() {
  return {
    accruedRemapCooldownDate: null,
    bonusRemaps: 1,
    charisma: 19,
    intelligence: 24,
    lastRemapDate: null,
    memory: 21,
    perception: 27,
    willpower: 22,
  }
}

function skillQueueResponse() {
  return { activeQueuePosition: null, entries: [], state: 'empty' }
}
