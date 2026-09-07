import { computed, reactive, ref } from 'vue'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  ApiQueryError,
  canRunPlatformProtectedQuery,
} from '@eve-space/platform-module-nuxt/runtime'
import { useActivityDetail } from '../src/runtime/app/composables/useActivityDetail.js'

const mocks = vi.hoisted(() => ({ identity: vi.fn(), route: vi.fn() }))
vi.mock('#imports', () => ({ useRoute: mocks.route }))
vi.mock('@eve-space/platform-module-nuxt/runtime', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePlatformIdentity: mocks.identity,
}))
afterEach(() => vi.unstubAllGlobals())

const id = '11111111-1111-4111-8111-111111111111'
const identity = reactive({
  authenticated: true,
  authorized: true,
  version: 7,
  characters: [{ characterId: 9001, name: 'Pilot', corporationId: 9801 }],
})
const route = reactive({
  query: { activityId: id, characterId: '9001' } as Record<string, string>,
  fullPath: '/jobs?characterId=9001',
})
const queries: {
  options: () => any
  data: ReturnType<typeof ref<any>>
  error: ReturnType<typeof ref<Error | null>>
  status: ReturnType<typeof ref<string>>
}[] = []
const detailGet = vi.fn()
const participationGet = vi.fn()
const moduleIds = ref(new Set(['organization-activity']))

beforeEach(() => {
  vi.clearAllMocks()
  queries.length = 0
  identity.authenticated = true
  identity.authorized = true
  identity.version = 7
  route.query = { activityId: id, characterId: '9001' }
  moduleIds.value = new Set(['organization-activity'])
  mocks.route.mockReturnValue(route)
  mocks.identity.mockReturnValue({
    authenticated: computed(() => identity.authenticated),
    organizationAuthorized: computed(() => identity.authorized),
    organizationVersion: computed(() => identity.version),
    characters: computed(() => identity.characters),
  })
  vi.stubGlobal('usePlatformModuleRuntime', () => ({ enabledModuleIds: moduleIds }))
  vi.stubGlobal('usePlatformApi', () => ({
    api: {
      modules: {
        'organization-activity': {
          details: { ':kind': { ':activityId': { $get: detailGet } } },
          characters: {
            ':characterId': { ':kind': { ':activityId': { $get: participationGet } } },
          },
        },
      },
    },
    auth: {
      eve: {
        reauthorize: {
          ':characterId': {
            $url: ({ param }: any) => new URL(`http://localhost/auth/${param.characterId}`),
          },
        },
      },
    },
  }))
  vi.stubGlobal('usePlatformProtectedQuery', (options: () => any) => {
    const query = {
      options,
      data: ref<any>(),
      error: ref<Error | null>(null),
      status: ref('success'),
      refresh: vi.fn(),
    }
    queries.push(query)
    return query
  })
})

function enabled(index: number, isClient = true) {
  const { access, subject } = queries[index]!.options()
  return canRunPlatformProtectedQuery({ ...access, subject, isClient })
}

test('allows authorized details and exact owned participation only on the client', () => {
  useActivityDetail('job')
  expect(enabled(0)).toBe(true)
  expect(enabled(1)).toBe(true)
  expect(enabled(0, false)).toBe(false)
  expect(enabled(1, false)).toBe(false)
  identity.authorized = false
  expect(enabled(0)).toBe(false)
  expect(enabled(1)).toBe(false)
  identity.authorized = true
  identity.authenticated = false
  expect(enabled(0)).toBe(false)
})

test('changes organization keys and rejects non-owned characters, invalid IDs and disabled modules', () => {
  useActivityDetail('project')
  identity.version = 8
  expect(queries[0]!.options().subject.organizationVersion).toBe(8)
  expect(queries[1]!.options().resource).toContain(8)
  route.query.characterId = '9002'
  expect(enabled(1)).toBe(false)
  route.query.activityId = 'invalid'
  expect(enabled(0)).toBe(false)
  route.query.activityId = id
  moduleIds.value = new Set()
  expect(enabled(0)).toBe(false)
})

test('character-only jobs use owned-route details and their freshness', () => {
  const state = useActivityDetail('job')
  queries[0]!.data.value = { activity: null, objectives: [], resource: { status: 'current' } }
  queries[1]!.data.value = { activity: { id, title: 'Private job' }, resource: { status: 'stale' } }
  expect(state.activity.value?.title).toBe('Private job')
  expect(state.state.value.status).toBe('stale')
  queries[1]!.data.value.resource.status = 'current'
  expect(state.state.value.status).toBe('ready')
})

test('passes exact IDs and cancellation to typed routes and handles failures', async () => {
  const state = useActivityDetail('job')
  detailGet.mockResolvedValue(Response.json({ activity: null, objectives: [] }))
  participationGet.mockResolvedValue(Response.json({ characterId: 9001, participation: [] }))
  const signal = new AbortController().signal
  await queries[0]!.options().query({ signal })
  await queries[1]!.options().query({ signal })
  expect(participationGet.mock.calls[0]?.[0].param).toEqual({
    kind: 'job',
    activityId: id,
    characterId: '9001',
  })
  expect(detailGet.mock.calls[0]?.[1]).toEqual({ init: { signal } })
  expect(state.authorizationUrl.value).toContain('/9001')
  queries[0]!.error.value = new Error('Unavailable')
  expect(state.state.value.status).toBe('unavailable')
  queries[0]!.error.value = null
  queries[0]!.status.value = 'pending'
  expect(state.state.value.status).toBe('loading')
})

test('shows explicit empty, authorization and invalid-link states', () => {
  const state = useActivityDetail('campaign')
  expect(state.state.value.status).toBe('unavailable')
  queries[0]!.error.value = new ApiQueryError('Permission required', { status: 403 })
  expect(state.state.value.status).toBe('authorization-required')
  queries[0]!.error.value = null
  identity.authorized = false
  expect(state.state.value.status).toBe('authorization-required')
  identity.authorized = true
  route.query.activityId = ''
  expect(state.state.value.status).toBe('unavailable')
  route.query.characterId = '9002'
  expect(state.authorizationUrl.value).toBeNull()
})

test('prefers public details and an explicit corporation when available', async () => {
  route.query.corporationId = '9802'
  const state = useActivityDetail('job')
  queries[0]!.data.value = {
    activity: { id, title: 'Public job' },
    resource: { status: 'current' },
  }
  queries[1]!.data.value = { activity: { id, title: 'Own job' }, resource: { status: 'stale' } }
  expect(state.activity.value?.title).toBe('Public job')
  expect(state.state.value.status).toBe('ready')
  detailGet.mockResolvedValue(Response.json({ activity: null }))
  await queries[0]!.options().query({ signal: new AbortController().signal })
  expect(detailGet.mock.calls[0]?.[0].query).toEqual({ corporationId: '9802' })
})
