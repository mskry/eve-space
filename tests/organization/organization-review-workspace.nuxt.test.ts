import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { useQueryCache } from '@pinia/colada'
import { flushPromises } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { computed, defineComponent, h, reactive, ref } from 'vue'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOrganizationReviewWorkspace } from '../../app/composables/useOrganizationReviewWorkspace'
import OrganizationReviewPage from '../../app/pages/organization/review.vue'
import { PRIVATE_QUERY_KEYS } from '../../app/queries/query-keys'
import { platformReviewerContributionTargetQueryKey } from '@eve-space/platform-module-nuxt/runtime'
import { cacheAdmissionForOrganization } from '../support/cache-admission'
import { clearQueryCache } from '../support/clear-query-cache'
import { queryServer } from '../support/query-server'

const mocks = vi.hoisted(() => ({
  announceAssertive: vi.fn(),
  announcePolite: vi.fn(),
  runtimeRefetch: vi.fn(),
  useAuthSession: vi.fn(),
  usePlatformModuleRuntime: vi.fn(),
  usePlatformReviewerPanels: vi.fn(),
}))

mockNuxtImport('useAuthSession', () => mocks.useAuthSession)
mockNuxtImport('usePlatformModuleRuntime', () => mocks.usePlatformModuleRuntime)
mockNuxtImport('usePlatformReviewerPanels', () => mocks.usePlatformReviewerPanels)
mockNuxtImport('useAnnouncer', () => () => ({
  assertive: mocks.announceAssertive,
  polite: mocks.announcePolite,
}))

const authenticated = ref(true)
const enabledModuleIds = ref(new Set(['alpha', 'beta']))
const enabledSectionKeys = ref(new Set(['beta/details']))
const authorized = ref([
  authorizedContribution('alpha', 'summary', 'managed-organization-account'),
  authorizedContribution('beta', 'details', 'managed-organization-character'),
])
const organizationVersion = ref(7)
const managedMemberLifecycleId = ref('member-lifecycle-1')
const runtimeError = ref<unknown>()
const mountedWrappers: { unmount(): void }[] = []
const routeState = reactive({ query: {} as Record<string, string> })
let routeHistory: Record<string, string>[] = []
let routeFuture: Record<string, string>[] = []
let testRouter!: ReturnType<typeof createTestRouter>

beforeAll(() => queryServer.listen({ onUnhandledRequest: 'error' }))
afterAll(() => queryServer.close())

beforeEach(() => {
  clearQueryCache()
  authenticated.value = true
  enabledModuleIds.value = new Set(['alpha', 'beta'])
  enabledSectionKeys.value = new Set(['beta/details'])
  authorized.value = [
    authorizedContribution('alpha', 'summary', 'managed-organization-account'),
    authorizedContribution('beta', 'details', 'managed-organization-character'),
  ]
  organizationVersion.value = 7
  managedMemberLifecycleId.value = 'member-lifecycle-1'
  runtimeError.value = undefined
  routeState.query = {}
  routeHistory = []
  routeFuture = []
  testRouter = createTestRouter()
  mocks.useAuthSession.mockReturnValue({
    authLoading: ref(false),
    authSession: computed(() => ({ authenticated: authenticated.value })),
  })
  mocks.usePlatformModuleRuntime.mockReturnValue({
    enabledModuleIds: computed(() => enabledModuleIds.value),
    enabledSectionKeys: computed(() => enabledSectionKeys.value),
    runtimeQuery: {
      data: ref({
        enabledModuleIds: ['alpha', 'beta'],
        enabledSections: [
          {
            moduleId: 'beta',
            sectionId: 'details',
            disclosureVersion: 2,
            activationVersion: 3,
          },
        ],
        shellNavigationOrder: {},
      }),
      error: runtimeError,
      refetch: mocks.runtimeRefetch,
    },
  })
  mocks.usePlatformReviewerPanels.mockReturnValue({
    contributions: [
      panel('alpha', 'summary', 'managed-organization-account'),
      panel('beta', 'details', 'managed-organization-character'),
    ],
  })
  queryServer.use(
    http.get('*/auth/session', () =>
      HttpResponse.json({
        authenticated: true,
        account: {
          userId: 'reviewer-user',
          mainCharacter: { characterId: 90_000_010, name: 'Reviewer Pilot' },
        },
      }),
    ),
    http.get('*/api/me/cache-admission', () =>
      HttpResponse.json(cacheAdmissionForOrganization('reviewer-user', 90_000_010)),
    ),
    http.get('*/api/organization/review', () =>
      HttpResponse.json({
        organizationVersion: organizationVersion.value,
        contributions: authorized.value,
      }),
    ),
    http.get('*/api/organization/review/members', ({ request }) => {
      const query = new URL(request.url).searchParams.get('query')
      return HttpResponse.json({
        organizationVersion: organizationVersion.value,
        status: 'available',
        items:
          query === secondaryMember().account.userId || query === '90000002'
            ? [secondaryMember()]
            : [member()],
        groupFacets: [
          { groupId: 'group-alpha', name: 'Alpha' },
          { groupId: 'group-remote', name: 'Remote reviewers' },
        ],
        nextCursor: null,
      })
    }),
    http.get('*/api/organization/review/members/:userId', ({ params }) => {
      const selected =
        params.userId === secondaryMember().account.userId ? secondaryMember() : member()
      return HttpResponse.json({
        organizationVersion: organizationVersion.value,
        member: targetMember(selected),
      })
    }),
  )
})

afterEach(async () => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  queryServer.resetHandlers()
  vi.clearAllMocks()
  await flushPromises()
})

describe('useOrganizationReviewWorkspace', () => {
  it('keeps the contribution unset when a reviewer selects only a member', async () => {
    let workspace!: ReturnType<typeof useOrganizationReviewWorkspace>
    const catalog = mocks.usePlatformReviewerPanels()
    const Host = defineComponent({
      setup() {
        workspace = useOrganizationReviewWorkspace({ route: routeState, router: testRouter })
        return () => h('span')
      },
    })
    const wrapper = await mountSuspended(Host, { route: '/organization/review' })
    mountedWrappers.push(wrapper)
    await expectWorkspaceReady(workspace)
    expect(workspace.groupFacets.value).toEqual([
      { groupId: 'group-alpha', name: 'Alpha' },
      { groupId: 'group-remote', name: 'Remote reviewers' },
    ])

    await workspace.selectMember(member())

    expect(testRouter.push).toHaveBeenCalledWith({
      query: { targetUserId: member().account.userId },
    })
    expect(workspace.selectedContribution.value).toBeUndefined()
    expect(workspace.selectedTarget.value).toBeUndefined()
    expect(workspace.panelFocusRequest.value).toBe(0)
    expect(catalog.contributions.every(({ load }) => !load.mock.calls.length)).toBe(true)
  })

  it('canonicalizes deep links, preserves disclosed character selection, and follows history without focus requests', async () => {
    let workspace!: ReturnType<typeof useOrganizationReviewWorkspace>
    const Host = defineComponent({
      setup() {
        workspace = useOrganizationReviewWorkspace({ route: routeState, router: testRouter })
        return () => h('span', workspace.selectedTarget.value?.kind ?? 'none')
      },
    })
    const wrapper = await mountSuspended(Host, {
      route: '/organization/review',
    })
    mountedWrappers.push(wrapper)
    const router = testRouter
    await expectWorkspaceReady(workspace)
    await router.push({
      query: {
        targetUserId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
        targetCharacterId: '90000001',
        contribution: 'beta/details',
      },
    })

    await vi.waitFor(() =>
      expect(routeState.query).toEqual({
        targetUserId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
        targetCharacterId: '90000001',
        contribution: 'beta/details',
      }),
    )
    await vi.waitFor(() => expect(workspace.selectedTarget.value).toBeDefined())
    expect(workspace.selectedTarget.value).toMatchObject({
      kind: 'managed-organization-character',
      characterId: 90_000_001,
    })
    expect(workspace.panelFocusRequest.value).toBe(0)

    await workspace.selectContribution('alpha/summary')
    await vi.waitFor(() => expect(routeState.query.contribution).toBe('alpha/summary'))
    expect(routeState.query.targetCharacterId).toBe('90000001')
    expect(workspace.selectedTarget.value?.kind).toBe('managed-organization-account')

    router.back()
    await vi.waitFor(() => expect(routeState.query.contribution).toBe('beta/details'))
    expect(workspace.panelFocusRequest.value).toBe(0)
  })

  it('resolves deep links outside the browse page without changing filters or stealing focus', async () => {
    let workspace!: ReturnType<typeof useOrganizationReviewWorkspace>
    const Host = defineComponent({
      setup() {
        workspace = useOrganizationReviewWorkspace({ route: routeState, router: testRouter })
        return () => h('span', workspace.selectedMember.value?.account.userId ?? 'none')
      },
    })
    const wrapper = await mountSuspended(Host, { route: '/organization/review' })
    mountedWrappers.push(wrapper)
    await expectWorkspaceReady(workspace)
    workspace.searchText.value = 'Review'
    workspace.corporationText.value = '98000001'
    await workspace.submitSearch()

    await testRouter.push({
      query: {
        targetUserId: secondaryMember().account.userId,
        targetCharacterId: '90000002',
        contribution: 'beta/details',
      },
    })
    await vi.waitFor(() =>
      expect(workspace.selectedMember.value?.account.userId).toBe(secondaryMember().account.userId),
    )
    expect(workspace.members.value.map(({ account }) => account.userId)).toEqual([
      member().account.userId,
    ])
    expect(workspace.searchText.value).toBe('Review')
    expect(workspace.corporationText.value).toBe('98000001')
    expect(workspace.panelFocusRequest.value).toBe(0)

    await testRouter.push({
      query: {
        targetUserId: member().account.userId,
        contribution: 'alpha/summary',
      },
    })
    await vi.waitFor(() =>
      expect(workspace.selectedMember.value?.account.userId).toBe(member().account.userId),
    )
    testRouter.back()
    await vi.waitFor(() =>
      expect(workspace.selectedMember.value?.account.userId).toBe(secondaryMember().account.userId),
    )
    testRouter.forward()
    await vi.waitFor(() =>
      expect(workspace.selectedMember.value?.account.userId).toBe(member().account.userId),
    )
    expect(workspace.searchText.value).toBe('Review')
    expect(workspace.corporationText.value).toBe('98000001')
    expect(workspace.panelFocusRequest.value).toBe(0)
  })

  it('retains an unresolved deep link while its exact target lookup is loading', async () => {
    const lookupGate = deferred<void>()
    const lookupStarted = vi.fn()
    queryServer.use(
      http.get('*/api/organization/review/members/:userId', async ({ params }) => {
        if (params.userId === secondaryMember().account.userId) {
          lookupStarted()
          await lookupGate.promise
          return HttpResponse.json({
            organizationVersion: organizationVersion.value,
            member: targetMember(secondaryMember()),
          })
        }
        return HttpResponse.json({
          organizationVersion: organizationVersion.value,
          member: targetMember(member()),
        })
      }),
    )
    let workspace!: ReturnType<typeof useOrganizationReviewWorkspace>
    const Host = defineComponent({
      setup() {
        workspace = useOrganizationReviewWorkspace({ route: routeState, router: testRouter })
        return () => h('span')
      },
    })
    const wrapper = await mountSuspended(Host, { route: '/organization/review' })
    mountedWrappers.push(wrapper)
    await expectWorkspaceReady(workspace)
    await testRouter.push({
      query: {
        targetUserId: secondaryMember().account.userId,
        contribution: 'alpha/summary',
      },
    })

    await vi.waitFor(() => expect(lookupStarted).toHaveBeenCalledOnce())
    expect(routeState.query.targetUserId).toBe(secondaryMember().account.userId)

    lookupGate.resolve()
    await vi.waitFor(() =>
      expect(workspace.selectedMember.value?.account.userId).toBe(secondaryMember().account.userId),
    )
    expect(routeState.query.targetUserId).toBe(secondaryMember().account.userId)
    expect(workspace.panelFocusRequest.value).toBe(0)
  })

  it.each([
    {
      name: 'a mismatched exact character',
      targetUserId: secondaryMember().account.userId,
      targetCharacterId: '90000002',
      contribution: 'beta/details',
      items: [secondaryMember(90_000_003)],
    },
    {
      name: 'no exact account result',
      targetUserId: secondaryMember().account.userId,
      targetCharacterId: undefined,
      contribution: 'alpha/summary',
      items: [],
    },
  ])(
    'clears an unresolved target after $name settles',
    async ({ contribution, items, targetCharacterId, targetUserId }) => {
      const exactLookup = vi.fn()
      queryServer.use(
        http.get('*/api/organization/review/members/:userId', ({ params }) => {
          exactLookup(params.userId)
          if (items.length === 0)
            return HttpResponse.json({ code: 'NOT_FOUND', message: 'Not found.' }, { status: 404 })
          return HttpResponse.json({
            organizationVersion: organizationVersion.value,
            member: targetMember(items[0]!),
          })
        }),
      )
      let workspace!: ReturnType<typeof useOrganizationReviewWorkspace>
      const Host = defineComponent({
        setup() {
          workspace = useOrganizationReviewWorkspace({ route: routeState, router: testRouter })
          return () => h('span')
        },
      })
      const wrapper = await mountSuspended(Host, { route: '/organization/review' })
      mountedWrappers.push(wrapper)
      await expectWorkspaceReady(workspace)

      await testRouter.push({
        query: {
          targetUserId,
          ...(targetCharacterId ? { targetCharacterId } : {}),
          contribution,
        },
      })

      await vi.waitFor(() => expect(exactLookup).toHaveBeenCalledWith(targetUserId))
      await vi.waitFor(() => expect(routeState.query).toEqual({ contribution }))
      expect(workspace.selectedMember.value).toBeUndefined()
    },
  )

  it('clears old target prefixes on contribution, lifecycle, permission, and organization changes', async () => {
    let workspace!: ReturnType<typeof useOrganizationReviewWorkspace>
    let queryCache!: ReturnType<typeof useQueryCache>
    const Host = defineComponent({
      setup() {
        queryCache = useQueryCache()
        workspace = useOrganizationReviewWorkspace({ route: routeState, router: testRouter })
        return () => h('span')
      },
    })
    const wrapper = await mountSuspended(Host, {
      route: '/organization/review',
    })
    mountedWrappers.push(wrapper)
    await expectWorkspaceReady(workspace)
    await testRouter.push({
      query: {
        targetUserId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
        contribution: 'alpha/summary',
      },
    })
    await vi.waitFor(() => expect(workspace.selectedTarget.value).toBeDefined())
    const alphaIdentity = {
      organizationVersion: 7,
      moduleId: 'alpha',
      contributionId: 'summary',
      target: workspace.selectedTarget.value!,
    }
    const alphaKey = [
      ...platformReviewerContributionTargetQueryKey(alphaIdentity),
      'private-record',
    ]
    queryCache.ensure({ key: alphaKey, query: async () => ({ secret: true }) })
    queryCache.setQueryData(alphaKey, { secret: true })

    await workspace.selectContribution('beta/details')
    await vi.waitFor(() => expect(queryCache.getQueryData(alphaKey)).toBeUndefined())
    await vi.waitFor(() =>
      expect(workspace.selectedTarget.value?.kind).toBe('managed-organization-character'),
    )

    const betaIdentity = {
      organizationVersion: 7,
      moduleId: 'beta',
      sectionId: 'details',
      contributionId: 'details',
      target: workspace.selectedTarget.value!,
    }
    const betaKey = [...platformReviewerContributionTargetQueryKey(betaIdentity), 'private-record']
    queryCache.ensure({ key: betaKey, query: async () => ({ secret: true }) })
    queryCache.setQueryData(betaKey, { secret: true })
    authorized.value = [authorizedContribution('alpha', 'summary', 'managed-organization-account')]
    await workspace.entryQuery.refetch()
    await vi.waitFor(() => expect(queryCache.getQueryData(betaKey)).toBeUndefined())
    expect(workspace.availableContributions.value.map(({ moduleId }) => moduleId)).toEqual([
      'alpha',
    ])

    await workspace.selectContribution('alpha/summary')
    await workspace.selectMember(member())
    await vi.waitFor(() => expect(workspace.selectedTarget.value).toBeDefined())
    const lifecycleKey = [
      ...platformReviewerContributionTargetQueryKey({
        organizationVersion: 7,
        moduleId: 'alpha',
        contributionId: 'summary',
        target: workspace.selectedTarget.value!,
      }),
      'private-record',
    ]
    queryCache.ensure({ key: lifecycleKey, query: async () => ({ secret: true }) })
    queryCache.setQueryData(lifecycleKey, { secret: true })
    managedMemberLifecycleId.value = 'member-lifecycle-2'
    await workspace.directoryQuery.refetch()
    await vi.waitFor(() => expect(queryCache.getQueryData(lifecycleKey)).toBeUndefined())

    const oldDirectoryKey = PRIVATE_QUERY_KEYS.organizationReviewerDirectory(7, { limit: 25 })
    organizationVersion.value = 8
    await workspace.entryQuery.refetch()
    await vi.waitFor(() => expect(workspace.organizationVersion.value).toBe(8))
    expect(queryCache.getQueryData(oldDirectoryKey)).toBeUndefined()
  })

  it.each([
    {
      name: 'contribution switch',
      change: async (workspace: ReturnType<typeof useOrganizationReviewWorkspace>) => {
        await workspace.selectContribution('alpha/summary')
      },
    },
    {
      name: 'section disablement',
      change: async () => {
        enabledSectionKeys.value = new Set()
        await flushPromises()
      },
    },
    {
      name: 'module disablement',
      change: async () => {
        enabledModuleIds.value = new Set(['alpha'])
        await flushPromises()
      },
    },
    {
      name: 'permission removal',
      change: async (workspace: ReturnType<typeof useOrganizationReviewWorkspace>) => {
        authorized.value = [
          authorizedContribution('alpha', 'summary', 'managed-organization-account'),
        ]
        await workspace.entryQuery.refetch()
      },
    },
    {
      name: 'target lifecycle change',
      change: async (workspace: ReturnType<typeof useOrganizationReviewWorkspace>) => {
        managedMemberLifecycleId.value = 'member-lifecycle-2'
        await workspace.directoryQuery.refetch()
      },
    },
    {
      name: 'organization change',
      change: async (workspace: ReturnType<typeof useOrganizationReviewWorkspace>) => {
        organizationVersion.value = 8
        await workspace.entryQuery.refetch()
      },
    },
  ])('removes a section-bound target prefix after $name', async ({ change }) => {
    let workspace!: ReturnType<typeof useOrganizationReviewWorkspace>
    let queryCache!: ReturnType<typeof useQueryCache>
    const Host = defineComponent({
      setup() {
        queryCache = useQueryCache()
        workspace = useOrganizationReviewWorkspace({ route: routeState, router: testRouter })
        return () => h('span')
      },
    })
    const wrapper = await mountSuspended(Host, { route: '/organization/review' })
    mountedWrappers.push(wrapper)
    await expectWorkspaceReady(workspace)
    await testRouter.push({
      query: {
        targetUserId: member().account.userId,
        targetCharacterId: String(member().managedAffiliation.characterId),
        contribution: 'beta/details',
      },
    })
    await vi.waitFor(() => expect(workspace.selectedTarget.value).toBeDefined())
    const key = [
      ...platformReviewerContributionTargetQueryKey({
        organizationVersion: 7,
        moduleId: 'beta',
        sectionId: 'details',
        contributionId: 'details',
        target: workspace.selectedTarget.value!,
      }),
      'private-record',
    ]
    expect(key.slice(0, 9)).toEqual([
      'private',
      'organization',
      7,
      'modules',
      'beta',
      'sections',
      'details',
      'reviewer',
      'contributions',
    ])
    queryCache.ensure({ key, query: async () => ({ secret: true }) })
    queryCache.setQueryData(key, { secret: true })

    await change(workspace)

    await vi.waitFor(() => expect(queryCache.getQueryData(key)).toBeUndefined())
  })

  it('gates a selected panel immediately when its section or module is disabled', async () => {
    let workspace!: ReturnType<typeof useOrganizationReviewWorkspace>
    const Host = defineComponent({
      setup() {
        workspace = useOrganizationReviewWorkspace({ route: routeState, router: testRouter })
        return () => h('span')
      },
    })
    const wrapper = await mountSuspended(Host, {
      route: '/organization/review',
    })
    mountedWrappers.push(wrapper)
    await expectWorkspaceReady(workspace)
    await testRouter.push({
      query: {
        targetUserId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
        contribution: 'beta/details',
      },
    })
    await vi.waitFor(() => expect(workspace.queryAccess.value.moduleEnabled).toBe(true))

    enabledSectionKeys.value = new Set()
    await flushPromises()

    expect(workspace.availableContributions.value.map(({ moduleId }) => moduleId)).toEqual([
      'alpha',
    ])
    expect(workspace.selectedContribution.value).toBeUndefined()
    expect(routeState.query).toEqual({
      targetUserId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
    })

    enabledSectionKeys.value = new Set(['beta/details'])
    await testRouter.push({
      query: {
        targetUserId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
        contribution: 'beta/details',
      },
    })
    await flushPromises()
    expect(workspace.selectedContribution.value?.moduleId).toBe('beta')

    enabledModuleIds.value = new Set(['alpha'])
    await flushPromises()
    expect(workspace.selectedContribution.value).toBeUndefined()
  })

  it.each([
    {
      name: 'search',
      change: async (workspace: ReturnType<typeof useOrganizationReviewWorkspace>) => {
        workspace.searchText.value = '  Review Pilot  '
        await workspace.submitSearch()
      },
      expected: { query: 'Review Pilot' },
    },
    {
      name: 'corporation',
      change: async (workspace: ReturnType<typeof useOrganizationReviewWorkspace>) => {
        workspace.corporationText.value = '98000002'
        await workspace.submitSearch()
      },
      expected: { corporationId: '98000002' },
    },
    {
      name: 'group',
      change: (workspace: ReturnType<typeof useOrganizationReviewWorkspace>) => {
        workspace.groupId.value = '00000000-0000-4000-8000-000000000099'
      },
      expected: { groupId: '00000000-0000-4000-8000-000000000099' },
    },
    {
      name: 'compliance state',
      change: (workspace: ReturnType<typeof useOrganizationReviewWorkspace>) => {
        workspace.complianceState.value = 'review_required'
      },
      expected: { complianceState: 'review_required' },
    },
    {
      name: 'block state',
      change: (workspace: ReturnType<typeof useOrganizationReviewWorkspace>) => {
        workspace.blocked.value = false
      },
      expected: { blocked: 'false' },
    },
    {
      name: 'audit state',
      change: (workspace: ReturnType<typeof useOrganizationReviewWorkspace>) => {
        workspace.auditState.value = 'stale'
      },
      expected: { auditState: 'stale' },
    },
    {
      name: 'sort field',
      change: (workspace: ReturnType<typeof useOrganizationReviewWorkspace>) => {
        workspace.sort.value = 'managed_since'
      },
      expected: { sort: 'managed_since' },
    },
    {
      name: 'sort direction',
      change: (workspace: ReturnType<typeof useOrganizationReviewWorkspace>) => {
        workspace.direction.value = 'desc'
      },
      expected: { direction: 'desc' },
    },
    {
      name: 'page size',
      change: (workspace: ReturnType<typeof useOrganizationReviewWorkspace>) => {
        workspace.limit.value = 50
      },
      expected: { limit: '50' },
    },
  ])('resets the cursor before a changed $name request', async ({ change, expected }) => {
    const requests: URL[] = []
    queryServer.use(
      http.get('*/api/organization/review/members', ({ request }) => {
        const url = new URL(request.url)
        requests.push(url)
        return HttpResponse.json({
          organizationVersion: organizationVersion.value,
          status: 'available',
          items: [member()],
          groupFacets: [],
          nextCursor: url.searchParams.has('cursor') ? null : 'opaque-next-cursor',
        })
      }),
    )
    let workspace!: ReturnType<typeof useOrganizationReviewWorkspace>
    const Host = defineComponent({
      setup() {
        workspace = useOrganizationReviewWorkspace({ route: routeState, router: testRouter })
        return () => h('span')
      },
    })
    const wrapper = await mountSuspended(Host, { route: '/organization/review' })
    mountedWrappers.push(wrapper)
    await expectWorkspaceReady(workspace)

    await workspace.nextDirectoryPage()
    expect(workspace.cursorHistory.value).toEqual([''])
    expect(requests.at(-1)?.searchParams.get('cursor')).toBe('opaque-next-cursor')
    requests.length = 0

    const pendingChange = change(workspace)
    expect(workspace.cursorHistory.value).toEqual([])
    await pendingChange

    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0))
    const changedRequest = requests.at(-1)!
    expect(changedRequest.searchParams.has('cursor')).toBe(false)
    for (const [name, value] of Object.entries(expected)) {
      expect(changedRequest.searchParams.get(name)).toBe(value)
    }
  })

  it('returns to the first page when an opaque cursor is rejected', async () => {
    const requests: URL[] = []
    queryServer.use(
      http.get('*/api/organization/review/members', ({ request }) => {
        const url = new URL(request.url)
        requests.push(url)
        if (url.searchParams.has('cursor'))
          return HttpResponse.json(
            {
              code: 'INVALID_REVIEWER_DIRECTORY_INPUT',
              message: 'Invalid reviewer directory input.',
            },
            { status: 400 },
          )
        return HttpResponse.json({
          organizationVersion: organizationVersion.value,
          status: 'available',
          items: [member()],
          groupFacets: [],
          nextCursor: 'opaque-next-cursor',
        })
      }),
    )
    let workspace!: ReturnType<typeof useOrganizationReviewWorkspace>
    const Host = defineComponent({
      setup() {
        workspace = useOrganizationReviewWorkspace({ route: routeState, router: testRouter })
        return () => h('span')
      },
    })
    const wrapper = await mountSuspended(Host, { route: '/organization/review' })
    mountedWrappers.push(wrapper)
    await expectWorkspaceReady(workspace)

    await workspace.nextDirectoryPage()

    await vi.waitFor(() => expect(workspace.cursorHistory.value).toEqual([]))
    expect(requests.some((request) => request.searchParams.has('cursor'))).toBe(true)
    expect(workspace.members.value).toHaveLength(1)
    expect(mocks.announcePolite).toHaveBeenCalledWith(
      'The directory page expired. Returned to the first page.',
    )
  })
})

describe('organization review page availability', () => {
  it.each([
    {
      status: 404,
      body: { code: 'NOT_FOUND', message: 'Not found.' },
      expected: 'Organization review is not available',
    },
    {
      status: 403,
      body: {
        code: 'ORGANIZATION_COMPLIANCE_REQUIRED',
        message: 'Current organization compliance is required.',
      },
      expected: 'Organization review access is blocked',
    },
    {
      status: 503,
      body: { code: 'REVIEW_UNAVAILABLE', message: 'Try again.' },
      expected: 'Organization review could not be loaded',
    },
  ])(
    'renders the canonical $status state without loading a panel',
    async ({ body, expected, status }) => {
      queryServer.use(
        http.get('*/api/organization/review', () => HttpResponse.json(body, { status })),
      )
      const catalog = mocks.usePlatformReviewerPanels()
      const PageHost = defineComponent({
        setup() {
          return () => h(OrganizationReviewPage)
        },
      })
      const wrapper = await mountSuspended(PageHost, {
        route: '/organization/review',
      })
      mountedWrappers.push(wrapper)

      await vi.waitFor(() => expect(wrapper.text()).toContain(expected))
      expect(wrapper.findAll('h1')).toHaveLength(1)
      expect(wrapper.get('h1').text()).toBe('Organization review')
      expect(wrapper.find('main').exists()).toBe(false)
      expect(
        catalog.contributions.every(
          (contribution: ReturnType<typeof panel>) => !contribution.load.mock.calls.length,
        ),
      ).toBe(true)
    },
  )

  it('fails closed when live module enablement cannot be verified', async () => {
    runtimeError.value = new Error('Runtime unavailable')
    const wrapper = await mountSuspended(OrganizationReviewPage, {
      route: '/organization/review',
    })
    mountedWrappers.push(wrapper)

    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('Review panel availability could not be verified'),
    )
    expect(wrapper.find('[data-testid="synthetic-panel"]').exists()).toBe(false)
  })
})

function panel(
  moduleId: string,
  contributionId: string,
  target: 'managed-organization-account' | 'managed-organization-character',
) {
  return {
    moduleId,
    contributionId,
    routeId: `${moduleId}-${contributionId}`,
    routePath: `/api/modules/${moduleId}/${contributionId}`,
    audience: 'hr' as const,
    requiredPermission: `${moduleId}.review`,
    target,
    panelExport: `./reviewer/${contributionId}`,
    label: `${moduleId} ${contributionId}`,
    description: `Review ${moduleId}.`,
    icon: 'overview' as const,
    order: moduleId === 'alpha' ? 10 : 20,
    ...(moduleId === 'beta' ? { sectionId: 'details' } : {}),
    load: vi.fn(),
  }
}

function authorizedContribution(
  moduleId: string,
  contributionId: string,
  target: 'managed-organization-account' | 'managed-organization-character',
) {
  return {
    moduleId,
    contributionId,
    routeId: `${moduleId}-${contributionId}`,
    routePath: `/api/modules/${moduleId}/${contributionId}`,
    target,
    label: `${moduleId} ${contributionId}`,
    description: `Review ${moduleId}.`,
    icon: 'overview' as const,
    order: moduleId === 'alpha' ? 10 : 20,
    ...(moduleId === 'beta' ? { sectionId: 'details' } : {}),
  }
}

function member(characterId = 90_000_001) {
  return {
    managedMemberLifecycleId: managedMemberLifecycleId.value,
    account: {
      userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
      mainCharacter: { characterId, name: 'Review Pilot' },
    },
    managedAffiliation: {
      characterId,
      name: 'Review Pilot',
      corporationId: 98_000_001,
      allianceId: null,
      checkedAt: '2026-09-18T00:00:00.000Z',
    },
  }
}

function secondaryMember(characterId = 90_000_002) {
  return {
    managedMemberLifecycleId: 'member-lifecycle-secondary',
    account: {
      userId: 'ee800380-dc86-4c4f-9f26-0e6031848dbf',
      mainCharacter: { characterId, name: 'Remote Pilot' },
    },
    managedAffiliation: {
      characterId,
      name: 'Remote Pilot',
      corporationId: 98_000_002,
      allianceId: null,
      checkedAt: '2026-09-18T00:00:00.000Z',
    },
  }
}

function targetMember(selected: ReturnType<typeof member>) {
  return {
    ...selected,
    characters: [
      {
        characterId: selected.managedAffiliation.characterId,
        subjectLifecycleId: `character-lifecycle-${selected.managedAffiliation.characterId}`,
        authorizationGeneration: 4,
        name: selected.managedAffiliation.name,
        isMain: true,
        affiliation: {
          corporationId: selected.managedAffiliation.corporationId,
          allianceId: selected.managedAffiliation.allianceId,
          membership: 'managed' as const,
          freshness: 'fresh' as const,
          checkedAt: selected.managedAffiliation.checkedAt,
        },
      },
    ],
  }
}

async function expectWorkspaceReady(workspace: ReturnType<typeof useOrganizationReviewWorkspace>) {
  await flushPromises()
  expect({
    authenticated: workspace.authSession.value.authenticated,
    asyncStatus: workspace.entryQuery.asyncStatus.value,
    error: workspace.entryError.value,
    status: workspace.entryQuery.status.value,
  }).toMatchObject({ authenticated: true })
  await vi.waitFor(() => expect(workspace.entryQuery.data.value).toBeDefined())
  expect(workspace.entryError.value).toBeNull()
  expect(workspace.availableContributions.value).toHaveLength(2)
  await vi.waitFor(() => expect(workspace.directoryQuery.data.value).toBeDefined())
}

function createTestRouter() {
  return {
    push: vi.fn(async ({ query }: { query: Record<string, string> }) => {
      routeHistory.push({ ...routeState.query })
      routeFuture = []
      routeState.query = { ...query }
    }),
    replace: vi.fn(async ({ query }: { query: Record<string, string> }) => {
      routeState.query = { ...query }
    }),
    back: vi.fn(() => {
      const previous = routeHistory.pop()
      if (!previous) return
      routeFuture.push({ ...routeState.query })
      routeState.query = previous
    }),
    forward: vi.fn(() => {
      const next = routeFuture.pop()
      if (!next) return
      routeHistory.push({ ...routeState.query })
      routeState.query = next
    }),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}
