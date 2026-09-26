import { resetCacheReady } from '@pinia/colada-plugin-cache-persister'
import { useQueryCache } from '@pinia/colada'
import { http, HttpResponse } from 'msw'
import { defineComponent, h, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyVerifiedQueryIdentity,
  awaitQueryPersistenceRestoration,
  readOrganizationReadiness,
  setOrganizationReadiness,
  transitionOrganizationQueries,
} from '../../app/query-persistence/runtime'
import {
  observeOrganizationReadiness,
  retryOrganizationReadiness,
} from '../../app/queries/organization-readiness'
import { ADMIN_QUERY_KEYS, PRIVATE_QUERY_KEYS } from '../../app/queries/query-keys'
import { organizationComplianceQuery } from '../../app/queries/organization'
import { createApiClient } from '../../app/utils/api-client'
import {
  cacheAdmissionForCharacter,
  cacheAdmissionForOrganization,
} from '../support/cache-admission'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'
import { queryServer } from '../support/query-server'

const api = createApiClient('http://localhost')
const session = {
  authenticated: true as const,
  account: { userId: 'user-1', mainCharacter: { characterId: 7, name: 'Pilot' } },
}
const currentContext = {
  authorityCharacter: null,
  capabilities: { reviewRegistration: true, viewRosterCoverage: true },
  claimAvailable: false,
  freshUntil: null,
  graceUntil: null,
  isBlocked: false,
  isOrganizationOwner: false,
  memberAccess: true,
  organization: {
    organizationId: 98_000_001,
    organizationName: 'New Corporation',
    organizationTicker: 'NEW',
    organizationType: 'corporation',
    organizationVersion: 2,
  },
  ownerFailureClass: null,
  ownerStatus: 'fresh',
  reviewDeadline: null,
}
const mountObservedReadiness = (
  currentSession: typeof session | { authenticated: false } = session,
  verified = ref(true),
) => {
  const Host = defineComponent({
    setup() {
      observeOrganizationReadiness(useQueryCache(), api, () => currentSession, verified)
      return () => h('span')
    },
  })
  return mountWithQueryPlugins(Host)
}

beforeEach(() => resetCacheReady())

describe('organization readiness', () => {
  it('reacquires context when an authenticated session becomes verified', async () => {
    const contextRequest = vi.fn()
    queryServer.use(
      http.get('http://localhost/api/organization/context', () => {
        contextRequest()
        return HttpResponse.json(currentContext)
      }),
    )
    const verified = ref(false)
    const { queryCache, wrapper } = mountObservedReadiness(session, verified)
    await awaitQueryPersistenceRestoration(queryCache)
    await applyVerifiedQueryIdentity(queryCache, session, async () =>
      cacheAdmissionForOrganization('user-1', 7, 2),
    )
    setOrganizationReadiness(queryCache, 'loading', 0)
    expect(contextRequest).not.toHaveBeenCalled()

    verified.value = true
    await vi.waitFor(() => expect(readOrganizationReadiness(queryCache).value).toBe('ready'))
    expect(contextRequest).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('reopens only after fresh admission and matching live context', async () => {
    const contextRequest = vi.fn()
    queryServer.use(
      http.get('http://localhost/api/organization/context', () => {
        contextRequest()
        return HttpResponse.json(currentContext)
      }),
    )
    const { queryCache, wrapper } = mountObservedReadiness()
    await awaitQueryPersistenceRestoration(queryCache)
    const loadAdmission = vi.fn(async () => cacheAdmissionForOrganization('user-1', 7, 2))
    await applyVerifiedQueryIdentity(queryCache, session, loadAdmission)
    setOrganizationReadiness(queryCache, 'loading', 0)
    expect(contextRequest).not.toHaveBeenCalled()

    await vi.waitFor(() => expect(readOrganizationReadiness(queryCache).value).toBe('ready'))
    expect(loadAdmission).toHaveBeenCalledTimes(2)
    expect(contextRequest).toHaveBeenCalledOnce()
    expect(readOrganizationReadiness(queryCache).value).toBe('ready')
    wrapper.unmount()
  })

  it('keeps prior context unavailable after a version mismatch', async () => {
    queryServer.use(
      http.get('http://localhost/api/organization/context', () =>
        HttpResponse.json({
          ...currentContext,
          organization: { ...currentContext.organization, organizationVersion: 1 },
        }),
      ),
    )
    const { queryCache, wrapper } = mountObservedReadiness()
    await awaitQueryPersistenceRestoration(queryCache)
    await applyVerifiedQueryIdentity(queryCache, session, async () =>
      cacheAdmissionForOrganization('user-1', 7, 2),
    )
    queryCache.setQueryData(PRIVATE_QUERY_KEYS.organizationContext(), {
      ...currentContext,
      organization: { ...currentContext.organization, organizationVersion: 1 },
    })
    setOrganizationReadiness(queryCache, 'loading', 0)

    await vi.waitFor(() => expect(readOrganizationReadiness(queryCache).value).toBe('unavailable'))
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.organizationContext())).toBeUndefined()
    wrapper.unmount()
  })

  it('does not request protected context without a member session', async () => {
    const contextRequest = vi.fn()
    queryServer.use(
      http.get('http://localhost/api/organization/context', () => {
        contextRequest()
        return HttpResponse.json(currentContext)
      }),
    )
    const { queryCache, wrapper } = mountObservedReadiness({ authenticated: false })
    setOrganizationReadiness(queryCache, 'loading', 0)

    await vi.waitFor(() => expect(readOrganizationReadiness(queryCache).value).toBe('unavailable'))
    expect(contextRequest).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('loads current context and registration remediation after verified negative admission', async () => {
    const limitedContext = { ...currentContext, claimAvailable: true, memberAccess: false }
    const contextRequest = vi.fn()
    const complianceRequest = vi.fn()
    queryServer.use(
      http.get('http://localhost/api/organization/context', () => {
        contextRequest()
        return HttpResponse.json(limitedContext)
      }),
      http.get('http://localhost/api/organization/compliance', () => {
        complianceRequest()
        return HttpResponse.json({ state: 'pending', organizationVersion: 2 })
      }),
    )
    const { queryCache, wrapper } = mountObservedReadiness()
    await awaitQueryPersistenceRestoration(queryCache)
    await applyVerifiedQueryIdentity(queryCache, session, async () =>
      cacheAdmissionForCharacter('user-1', 7),
    )
    setOrganizationReadiness(queryCache, 'loading', 0)

    await vi.waitFor(() => expect(readOrganizationReadiness(queryCache).value).toBe('ready'))
    expect(queryCache.getQueryData(PRIVATE_QUERY_KEYS.organizationContext())).toMatchObject({
      claimAvailable: true,
      memberAccess: false,
    })
    expect(contextRequest).toHaveBeenCalledOnce()
    const compliance = await queryCache.fetch(queryCache.ensure(organizationComplianceQuery(api)))
    expect(compliance.data?.state).toBe('pending')
    expect(complianceRequest).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('waits for live admission and retries without sending an early context request', async () => {
    const contextRequest = vi.fn()
    queryServer.use(
      http.get('http://localhost/api/organization/context', () => {
        contextRequest()
        return HttpResponse.json(currentContext)
      }),
    )
    const { queryCache, wrapper } = mountObservedReadiness()
    await awaitQueryPersistenceRestoration(queryCache)
    const loadAdmission = vi
      .fn()
      .mockResolvedValueOnce(cacheAdmissionForOrganization('user-1', 7, 1))
      .mockRejectedValueOnce(new TypeError('Admission unavailable'))
      .mockResolvedValue(cacheAdmissionForOrganization('user-1', 7, 2))
    await applyVerifiedQueryIdentity(queryCache, session, loadAdmission)
    setOrganizationReadiness(queryCache, 'loading', 0)

    await vi.waitFor(() => expect(readOrganizationReadiness(queryCache).value).toBe('unavailable'))
    expect(contextRequest).not.toHaveBeenCalled()
    retryOrganizationReadiness(queryCache)
    await vi.waitFor(() => expect(readOrganizationReadiness(queryCache).value).toBe('ready'))
    expect(loadAdmission).toHaveBeenCalledTimes(3)
    expect(contextRequest).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('rejects context that disagrees with the current administrator selection', async () => {
    queryServer.use(
      http.get('http://localhost/api/organization/context', () =>
        HttpResponse.json(currentContext),
      ),
      http.get('http://localhost/api/admin/session', () =>
        HttpResponse.json({
          authenticated: true,
          account: { organization: { id: 98_000_002, type: 'corporation' } },
        }),
      ),
    )
    const { queryCache, wrapper } = mountObservedReadiness()
    await awaitQueryPersistenceRestoration(queryCache)
    await applyVerifiedQueryIdentity(queryCache, session, async () =>
      cacheAdmissionForOrganization('user-1', 7, 2),
    )
    queryCache.setQueryData(ADMIN_QUERY_KEYS.session, {
      authenticated: true,
      account: { organization: { id: 98_000_001, type: 'corporation' } },
    })
    setOrganizationReadiness(queryCache, 'loading', 0)

    await vi.waitFor(() => expect(readOrganizationReadiness(queryCache).value).toBe('unavailable'))
    wrapper.unmount()
  })

  it('keeps the gate closed on failed reload and permits explicit retry', async () => {
    let available = false
    queryServer.use(
      http.get('http://localhost/api/organization/context', () =>
        available
          ? HttpResponse.json(currentContext)
          : HttpResponse.json({ message: 'Unavailable' }, { status: 403 }),
      ),
    )
    const { queryCache, wrapper } = mountObservedReadiness()
    await awaitQueryPersistenceRestoration(queryCache)
    await applyVerifiedQueryIdentity(queryCache, session, async () =>
      cacheAdmissionForOrganization('user-1', 7, 2),
    )
    setOrganizationReadiness(queryCache, 'loading', 0)

    await vi.waitFor(() => expect(readOrganizationReadiness(queryCache).value).toBe('unavailable'))
    available = true
    retryOrganizationReadiness(queryCache)
    expect(readOrganizationReadiness(queryCache).value).toBe('loading')
    await vi.waitFor(() => expect(readOrganizationReadiness(queryCache).value).toBe('ready'))
    wrapper.unmount()
  })

  it('retries live context after a durable organization invalidation fails', async () => {
    const contextRequest = vi.fn()
    queryServer.use(
      http.get('http://localhost/api/organization/context', () => {
        contextRequest()
        return HttpResponse.json(currentContext)
      }),
    )
    const { queryCache, wrapper } = mountObservedReadiness()
    await awaitQueryPersistenceRestoration(queryCache)
    await applyVerifiedQueryIdentity(queryCache, session, async () =>
      cacheAdmissionForOrganization('user-1', 7, 2),
    )

    await expect(transitionOrganizationQueries(queryCache)).resolves.toBe(false)
    expect(readOrganizationReadiness(queryCache).value).toBe('unavailable')
    retryOrganizationReadiness(queryCache)
    await vi.waitFor(() => expect(readOrganizationReadiness(queryCache).value).toBe('ready'))
    expect(contextRequest).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
})
