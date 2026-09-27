import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ref } from 'vue'
import { canRunPlatformProtectedQuery } from '@eve-space/platform-module-nuxt/runtime'

const mocks = vi.hoisted(() => ({
  api: { api: {} },
  createApiClient: vi.fn(),
  organizationContextQuery: vi.fn(),
  useQuery: vi.fn(),
  useQueryCache: vi.fn(),
}))

vi.mock('@pinia/colada', () => ({ useQuery: mocks.useQuery, useQueryCache: mocks.useQueryCache }))
vi.mock('../../app/queries/organization', () => ({
  organizationContextQuery: mocks.organizationContextQuery,
}))
vi.mock('../../app/utils/api-client', () => ({ createApiClient: mocks.createApiClient }))
vi.mock('../../app/query-persistence/runtime', () => ({
  readOrganizationReadiness: () => organizationReady,
}))

import { usePlatformHostIdentity } from '../../app/composables/usePlatformHostIdentity'

const authSession = ref({ authenticated: false })
const organizationReady = ref<'ready' | 'loading'>('ready')
const characters = ref([{ characterId: 9001, corporationId: 98_000_001, name: 'Primary' }])
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
  organizationReady.value = 'ready'
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
  expect(queryOptions.key).toStrictEqual(['organization-context'])
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

  organization.value.memberAccess = true
  organizationReady.value = 'loading'
  expect(identity.organizationAuthorized.value).toBe(false)
  expect(identity.organizationVersion.value).toBe(0)
  expect(queryOptions.enabled()).toBeFalsy()
  expect(
    canRunPlatformProtectedQuery({
      authenticated: identity.authenticated.value,
      authorized: identity.organizationAuthorized.value,
      isClient: true,
      moduleEnabled: true,
      subject: { kind: 'organization', organizationVersion: identity.organizationVersion.value },
    }),
  ).toBe(false)
})
