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
  characters: [{ characterId: 9001, name: 'Pilot', corporationId: 9801 }],
  version: 7,
})
const route = reactive({
  fullPath: '/jobs?characterId=9001',
  query: { activityId: id, characterId: '9001' } as Record<string, string>,
})
const queries: {
  options: () => any
  data: ReturnType<typeof ref<any>>
  error: ReturnType<typeof ref<Error | null>>
  persistencePresentation: ReturnType<typeof ref<any>>
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
    characters: computed(() => identity.characters),
    organizationAuthorized: computed(() => identity.authorized),
    organizationVersion: computed(() => identity.version),
  })
  vi.stubGlobal('usePlatformModuleRuntime', () => ({ enabledModuleIds: moduleIds }))
  vi.stubGlobal('usePlatformApi', () => ({
    api: {
      modules: {
        'organization-activity': {
          characters: {
            ':characterId': { ':kind': { ':activityId': { $get: participationGet } } },
          },
          details: { ':kind': { ':activityId': { $get: detailGet } } },
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
      data: ref<any>(),
      error: ref<Error | null>(null),
      options,
      persistencePresentation: ref<any>({ kind: 'fresh' }),
      refresh: vi.fn(),
      status: ref('success'),
    }
    queries.push(query)
    return query
  })
})

function enabled(index: number, isClient = true) {
  const { access, subject } = queries[index]!.options()
  return canRunPlatformProtectedQuery({ ...access, isClient, subject })
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
  expect(state.participationState.value.status).toBe('stale')
  queries[1]!.data.value.resource.status = 'current'
  expect(state.state.value.status).toBe('ready')
  expect(state.participationState.value.status).toBe('ready')
})

test('keeps detail and participation persistence presentation distinct', () => {
  const state = useActivityDetail('job')
  queries[0]!.data.value = {
    activity: { id, title: 'Organization detail' },
    resource: { status: 'current' },
  }
  queries[0]!.persistencePresentation.value = {
    kind: 'server-stale',
    validatedAt: '2026-09-15T01:00:00.000Z',
  }
  queries[1]!.persistencePresentation.value = {
    kind: 'restored-refresh-failed',
    originalSuccessAt: '2026-09-15T00:00:00.000Z',
  }

  expect(state.activityPresentation.value.kind).toBe('server-stale')
  expect(state.participation.persistencePresentation.value.kind).toBe('restored-refresh-failed')

  queries[0]!.data.value.activity = null
  queries[1]!.data.value = {
    activity: { id, title: 'Character detail' },
    participation: [],
    resource: { status: 'current' },
  }
  expect(state.activityPresentation.value.kind).toBe('restored-refresh-failed')
})

test('maps participation authorization, failure, loading and empty states', () => {
  const state = useActivityDetail('job')
  queries[1]!.data.value = {
    participation: [],
    resource: { message: 'Grant the required scope.', status: 'authorization-required' },
  }

  expect(state.participationState.value).toMatchObject({
    action: { label: 'Authorize character' },
    message: 'Grant the required scope.',
    status: 'authorization-required',
    title: 'Authorize Pilot',
  })

  queries[1]!.data.value = undefined
  queries[1]!.error.value = new Error('ESI is unavailable')
  expect(state.participationState.value).toStrictEqual({
    message: 'ESI is unavailable',
    retryLabel: 'Retry',
    status: 'unavailable',
    title: 'Participation unavailable',
  })

  queries[1]!.error.value = null
  queries[1]!.status.value = 'pending'
  expect(state.participationState.value.status).toBe('loading')

  queries[1]!.status.value = 'success'
  expect(state.participationState.value).toStrictEqual({
    message: 'No current participation collection is available.',
    status: 'unavailable',
    title: 'Participation unavailable',
  })

  route.query.characterId = '9002'
  queries[1]!.error.value = new ApiQueryError('Character scope required', { status: 401 })
  expect(state.participationState.value).toStrictEqual({
    action: null,
    message: 'Character scope required',
    status: 'authorization-required',
    title: 'Character authorization required',
  })
})

test('passes exact IDs and cancellation to typed routes and handles failures', async () => {
  const state = useActivityDetail('job')
  detailGet.mockResolvedValue(
    Response.json({
      activity: null,
      objectives: [],
      refreshFailureClass: 'esi-unavailable',
      stale: true,
      validatedAt: '2026-09-07T10:00:00.000Z',
    }),
  )
  participationGet.mockResolvedValue(
    Response.json({
      characterId: 9001,
      participation: [],
      refreshFailureClass: 'esi-cooldown',
      stale: true,
      validatedAt: '2026-09-07T09:55:00.000Z',
    }),
  )
  const signal = new AbortController().signal
  const detail = await queries[0]!.options().query({ signal })
  const participation = await queries[1]!.options().query({ signal })
  expect(detail).toMatchObject({
    refreshFailureClass: 'esi-unavailable',
    stale: true,
    validatedAt: '2026-09-07T10:00:00.000Z',
  })
  expect(participation).toMatchObject({
    refreshFailureClass: 'esi-cooldown',
    stale: true,
    validatedAt: '2026-09-07T09:55:00.000Z',
  })
  expect(participationGet.mock.calls[0]?.[0].param).toStrictEqual({
    activityId: id,
    characterId: '9001',
    kind: 'job',
  })
  expect(detailGet.mock.calls[0]?.[1]).toStrictEqual({ init: { signal } })
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
  expect(detailGet.mock.calls[0]?.[0].query).toStrictEqual({ corporationId: '9802' })
})
