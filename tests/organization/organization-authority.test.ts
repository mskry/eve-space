import { useQueryCache } from '@pinia/colada'
import { flushPromises } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { computed, defineComponent, h, onMounted, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useOrganizationAuthority } from '../../app/composables/useOrganizationAuthority'
import { PRIVATE_QUERY_KEYS } from '../../app/queries/query-keys'
import { invalidatePrivateQueryScope } from '../../app/query-persistence/runtime'
import { createApiClient } from '../../app/utils/api-client'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'
import { queryServer } from '../support/query-server'

const apiClient = createApiClient('http://localhost')

describe('organization authority', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('does not request organization context before deployment setup', async () => {
    let contextRequests = 0
    queryServer.use(
      http.get('http://localhost/api/admin/setup', () =>
        HttpResponse.json({ required: true, available: true }),
      ),
      http.get('http://localhost/api/organization/context', () => {
        contextRequests += 1
        return HttpResponse.json({}, { status: 500 })
      }),
    )
    const initializeAuth = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useAuthSession', () => ({
      authLoading: ref(false),
      authSession: ref({ authenticated: true }),
      authUnavailable: ref(false),
      initializeAuth,
    }))
    const Root = defineComponent({
      setup() {
        const authority = useOrganizationAuthority(apiClient)
        onMounted(authority.initialize)
        return () => h('span', authority.deploymentConfigured.value ? 'configured' : 'unconfigured')
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(wrapper.text()).toBe('unconfigured')
    expect(initializeAuth).toHaveBeenCalledOnce()
    expect(contextRequests).toBe(0)
    wrapper.unmount()
  })

  it('loads owner authority and refreshes roles after grant and revocation', async () => {
    const grantRequests: unknown[] = []
    const revokeRequests: unknown[] = []
    const context = organizationOwnerContext()
    queryServer.use(
      http.get('http://localhost/api/admin/setup', () =>
        HttpResponse.json({ required: false, available: true }),
      ),
      http.get('http://localhost/api/organization/context', () => HttpResponse.json(context)),
      http.get('http://localhost/api/organization/roles', () =>
        HttpResponse.json({ grants: [roleGrant()] }),
      ),
      http.post('http://localhost/api/organization/roles', async ({ request }) => {
        grantRequests.push(await request.json())
        return HttpResponse.json({ grant: roleGrant() }, { status: 201 })
      }),
      http.post('http://localhost/api/organization/roles/:grantId/revoke', async ({ request }) => {
        revokeRequests.push(await request.json())
        return HttpResponse.json({ grant: roleGrant() })
      }),
    )
    const initializeAuth = vi.fn().mockResolvedValue(true)
    const authSession = ref({ authenticated: true })
    const authUnavailable = ref(false)
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useAuthSession', () => ({
      authLoading: ref(false),
      authSession,
      authUnavailable,
      initializeAuth,
    }))
    let authority!: ReturnType<typeof useOrganizationAuthority>
    let invalidateQueries!: ReturnType<typeof vi.spyOn>
    const Root = defineComponent({
      setup() {
        const queryCache = useQueryCache()
        queryCache.setQueryData(PRIVATE_QUERY_KEYS.organizationContext(), context)
        queryCache.setQueryData(PRIVATE_QUERY_KEYS.organizationRoles(), { grants: [roleGrant()] })
        invalidateQueries = vi.spyOn(queryCache, 'invalidateQueries')
        authority = useOrganizationAuthority(apiClient)
        onMounted(authority.initialize)
        return () =>
          h(
            'span',
            `${authority.authorityContext.value?.organization.organizationName ?? 'loading'}:${authority.roleGrants.value.length}`,
          )
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(wrapper.text()).toBe('Example Corporation:1')
    expect(authority.loading.value).toBe(false)

    await authority.grantRole({
      userId: 'new-user',
      role: 'hr_auditor',
      reason: 'Coverage test',
    })
    expect(grantRequests).toEqual([
      { userId: 'new-user', role: 'hr_auditor', reason: 'Coverage test' },
    ])

    await authority.revokeRole('grant-1', 'No longer required')
    expect(revokeRequests).toEqual([{ reason: 'No longer required' }])
    expect(invalidateQueries).toHaveBeenCalledTimes(2)
    expect(authority.mutationPending.value).toBe(false)
    expect(authority.errorMessage.value).toBe('')

    authSession.value = { authenticated: false }
    authUnavailable.value = true
    expect(authority.authorityContext.value).toBeUndefined()
    expect(authority.roleGrants.value).toEqual([])
    expect(authority.errorMessage.value).toBe('Session verification is unavailable.')
    wrapper.unmount()
  })

  it('resets pending mutation state and ignores a late grant after invalidation', async () => {
    let finishGrant!: () => void
    const grantCanFinish = new Promise<void>((resolve) => (finishGrant = resolve))
    const context = organizationOwnerContext()
    queryServer.use(
      http.get('http://localhost/api/admin/setup', () =>
        HttpResponse.json({ required: false, available: true }),
      ),
      http.get('http://localhost/api/organization/context', () => HttpResponse.json(context)),
      http.get('http://localhost/api/organization/roles', () =>
        HttpResponse.json({ grants: [roleGrant()] }),
      ),
      http.post('http://localhost/api/organization/roles', async () => {
        await grantCanFinish
        return HttpResponse.json({ grant: roleGrant() }, { status: 201 })
      }),
    )
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useAuthSession', () => ({
      authLoading: ref(false),
      authSession: ref({ authenticated: true }),
      authUnavailable: ref(false),
      initializeAuth: vi.fn().mockResolvedValue(true),
    }))
    let authority!: ReturnType<typeof useOrganizationAuthority>
    let queryCache!: ReturnType<typeof useQueryCache>
    const Root = defineComponent({
      setup() {
        queryCache = useQueryCache()
        queryCache.setQueryData(PRIVATE_QUERY_KEYS.organizationContext(), context)
        queryCache.setQueryData(PRIVATE_QUERY_KEYS.organizationRoles(), { grants: [roleGrant()] })
        authority = useOrganizationAuthority(apiClient)
        return () => h('span')
      },
    })
    const { wrapper } = mountWithQueryPlugins(Root)
    const revision = authority.invalidationRevision.value
    const grant = authority.grantRole({
      userId: 'new-user',
      role: 'hr_auditor',
      reason: 'Coverage test',
    })
    await vi.waitFor(() => expect(authority.mutationPending.value).toBe(true))

    void invalidatePrivateQueryScope(queryCache, { kind: 'organization' })

    expect(authority.invalidationRevision.value).toBe(revision + 1)
    expect(authority.mutationPending.value).toBe(false)
    finishGrant()
    await expect(grant).resolves.toBe(false)
    expect(authority.mutationPending.value).toBe(false)
    wrapper.unmount()
  })

  it('keeps an authorization denial visible after it resets organization state', async () => {
    queryServer.use(
      http.post('http://localhost/api/organization/roles', () =>
        HttpResponse.json(
          {
            code: 'ORGANIZATION_OWNER_REQUIRED',
            message: 'Organization owner authority is required.',
          },
          { status: 403 },
        ),
      ),
    )
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useAuthSession', () => ({
      authLoading: ref(false),
      authSession: ref({ authenticated: false }),
      authUnavailable: ref(false),
      initializeAuth: vi.fn().mockResolvedValue(false),
    }))
    let authority!: ReturnType<typeof useOrganizationAuthority>
    const Root = defineComponent({
      setup() {
        authority = useOrganizationAuthority(apiClient)
        return () => h('span')
      },
    })
    const { wrapper } = mountWithQueryPlugins(Root)
    const revision = authority.invalidationRevision.value

    await expect(
      authority.grantRole({ userId: 'new-user', role: 'hr_auditor', reason: 'Coverage test' }),
    ).rejects.toThrow('Organization owner authority is required.')

    expect(authority.invalidationRevision.value).toBe(revision + 1)
    expect(authority.errorMessage.value).toBe('Organization owner authority is required.')
    wrapper.unmount()
  })
})

function roleGrant() {
  return {
    grantId: 'grant-1',
    userId: 'role-user',
    role: 'director' as const,
    reason: 'Leadership duty.',
    grantedByUserId: 'owner-user',
    grantedAt: '2026-08-31T12:00:00.000Z',
    mainCharacterId: 1_404_328_063,
    mainCharacterName: 'Director',
  }
}

function organizationOwnerContext() {
  return {
    organization: {
      organizationType: 'corporation' as const,
      organizationId: 98_000_001,
      organizationName: 'Example Corporation',
      organizationTicker: 'EX',
      organizationVersion: 1,
    },
    isOrganizationOwner: true,
    isBlocked: false,
    memberAccess: true,
    capabilities: { reviewRegistration: true, viewRosterCoverage: true },
    claimAvailable: false,
    ownerStatus: 'fresh' as const,
    reviewDeadline: null,
    authorityCharacter: null,
  }
}
