import { useQueryCache } from '@pinia/colada'
import { flushPromises } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { computed, defineComponent, h, onMounted, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useOrganizationAuthority } from '../../app/composables/useOrganizationAuthority'
import { PRIVATE_QUERY_KEYS } from '../../app/queries/query-keys'
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
      authSession: ref({ authenticated: true }),
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
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('useAuthSession', () => ({
      authSession: ref({ authenticated: true }),
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
    capabilities: { viewRosterCoverage: true },
    claimAvailable: false,
    ownerStatus: 'fresh' as const,
    reviewDeadline: null,
    authorityCharacter: null,
  }
}
