import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ref } from 'vue'

const mocks = vi.hoisted(() => ({
  api: { api: {} },
  createApiClient: vi.fn(),
  organizationContextQuery: vi.fn(),
  useQuery: vi.fn(),
}))

vi.mock('@pinia/colada', () => ({ useQuery: mocks.useQuery }))
vi.mock('../../app/queries/organization', () => ({
  organizationContextQuery: mocks.organizationContextQuery,
}))
vi.mock('../../app/utils/api-client', () => ({ createApiClient: mocks.createApiClient }))

import { usePlatformHostIdentity } from '../../app/composables/usePlatformHostIdentity'

const authSession = ref({ authenticated: false })
const characters = ref([{ characterId: 9001, name: 'Primary', corporationId: 98_000_001 }])
const organization = ref<
  | {
      memberAccess: boolean
      organization: { organizationVersion: number }
    }
  | undefined
>()

beforeEach(() => {
  vi.clearAllMocks()
  authSession.value = { authenticated: false }
  organization.value = undefined
  mocks.createApiClient.mockReturnValue(mocks.api)
  mocks.organizationContextQuery.mockReturnValue({ key: ['organization-context'] })
  mocks.useQuery.mockReturnValue({ data: organization })
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { apiBase: 'https://api.example.test' } }))
  vi.stubGlobal(
    'useAuthSession',
    vi.fn(() => ({ authSession })),
  )
  vi.stubGlobal(
    'useCharacterRoster',
    vi.fn(() => ({ characters })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

test('adapts host authentication, organization, and roster state for platform modules', () => {
  const identity = usePlatformHostIdentity()
  const queryOptions = mocks.useQuery.mock.calls[0]?.[0]

  expect(mocks.createApiClient).toHaveBeenCalledWith('https://api.example.test')
  expect(mocks.organizationContextQuery).toHaveBeenCalledWith(mocks.api)
  expect(queryOptions.key).toEqual(['organization-context'])
  expect(queryOptions.enabled()).toBeFalsy()
  expect(identity.authenticated.value).toBe(false)
  expect(identity.organizationAuthorized.value).toBe(false)
  expect(identity.organizationVersion.value).toBe(0)
  expect(identity.characters).toBe(characters)

  authSession.value = { authenticated: true }
  organization.value = {
    memberAccess: true,
    organization: { organizationVersion: 7 },
  }

  expect(queryOptions.enabled()).toBe(import.meta.client)
  expect(identity.authenticated.value).toBe(true)
  expect(identity.organizationAuthorized.value).toBe(true)
  expect(identity.organizationVersion.value).toBe(7)

  organization.value.memberAccess = false
  expect(identity.organizationAuthorized.value).toBe(false)
})
