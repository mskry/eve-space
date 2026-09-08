import { useQueryCache } from '@pinia/colada'
import { flushPromises } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { computed, defineComponent, h, ref, watch } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useOrganizationHrReview } from '../../app/composables/useOrganizationHrReview'
import { useOrganizationRosterCoverage } from '../../app/composables/useOrganizationRosterCoverage'
import { createApiClient } from '../../app/utils/api-client'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'
import { queryServer } from '../support/query-server'

const apiClient = createApiClient('http://localhost')

describe('organization HR review', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('loads review data, appends unique older audit events, and submits decisions', async () => {
    const approvalRequests: unknown[] = []
    const decisionRequests: unknown[] = []
    let setupRequests = 0
    let contextRequests = 0
    queryServer.use(
      http.get('http://localhost/api/admin/setup', () => {
        setupRequests += 1
        return HttpResponse.json({ required: false, available: true })
      }),
      http.get('http://localhost/api/organization/context', () => {
        contextRequests += 1
        return HttpResponse.json(organizationContext(true))
      }),
      http.get('http://localhost/api/organization/exceptions', () =>
        HttpResponse.json({
          reviewCandidates: [{ userId: 'candidate-user', characterId: 90_000_001 }],
          exceptions: [{ exceptionId: 'exception-1', characterId: 90_000_002 }],
        }),
      ),
      http.get('http://localhost/api/organization/audit', ({ request }) => {
        const before = new URL(request.url).searchParams.get('beforeAuditSequence')
        return HttpResponse.json(
          before
            ? {
                events: [auditEvent('audit-2'), auditEvent('audit-1')],
                nextBeforeAuditSequence: null,
              }
            : {
                events: [auditEvent('audit-3'), auditEvent('audit-2')],
                nextBeforeAuditSequence: '2',
              },
        )
      }),
      http.post(
        'http://localhost/api/organization/members/:userId/characters/:characterId/exception',
        async ({ request }) => {
          approvalRequests.push(await request.json())
          return HttpResponse.json({ exception: { exceptionId: 'exception-2' } }, { status: 201 })
        },
      ),
      http.post(
        'http://localhost/api/organization/exceptions/:exceptionId/revoke',
        async ({ request }) => {
          decisionRequests.push(await request.json())
          return HttpResponse.json({ exception: { exceptionId: 'exception-1' } })
        },
      ),
    )
    const initializeAuth = vi.fn().mockResolvedValue(true)
    stubNuxtCompositionGlobals(initializeAuth)
    const watchSpy = vi.fn(watch)
    vi.stubGlobal('watch', watchSpy)
    let review!: ReturnType<typeof useOrganizationHrReview>
    let invalidateQueries!: ReturnType<typeof vi.spyOn>
    const Root = defineComponent({
      setup() {
        invalidateQueries = vi.spyOn(useQueryCache(), 'invalidateQueries')
        review = useOrganizationHrReview(apiClient)
        return () =>
          h(
            'span',
            `${review.canReview.value}:${review.reviewCandidates.value.length}:${review.exceptions.value.length}`,
          )
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()
    await review.initialize()
    await flushPromises()

    expect({ contextRequests, setupRequests }).toEqual({ contextRequests: 1, setupRequests: 1 })
    await vi.waitFor(() => expect(wrapper.text()).toBe('true:1:1'))
    expect(review.auditEvents.value.map(({ auditId }) => auditId)).toEqual(['audit-3', 'audit-2'])
    expect(review.hasOlderAuditEvents.value).toBe(true)
    expect(review.auditLoading.value).toBe(false)
    expect(review.loading.value).toBe(false)
    expect(review.mutationPending.value).toBe(false)
    expect(review.errorMessage.value).toBe('')

    review.loadOlderAuditEvents()
    const observeAuditPage = watchSpy.mock.calls[0]?.[1] as unknown as (
      page: ReturnType<typeof auditPage> | undefined,
    ) => void
    observeAuditPage(undefined)
    observeAuditPage(auditPage(['audit-2', 'audit-1']))
    expect(review.auditEvents.value.map(({ auditId }) => auditId)).toEqual([
      'audit-3',
      'audit-2',
      'audit-1',
    ])

    await review.approveException({
      userId: 'candidate-user',
      characterId: 90_000_001,
      reason: 'Approved for review coverage.',
      expiresAt: null,
    })
    await review.decideException('exception-1', 'revoke', 'No longer required.')

    expect(approvalRequests).toEqual([{ reason: 'Approved for review coverage.', expiresAt: null }])
    expect(decisionRequests).toEqual([{ reason: 'No longer required.' }])
    expect(invalidateQueries).toHaveBeenCalledTimes(4)

    queryServer.use(
      http.post(
        'http://localhost/api/organization/members/:userId/characters/:characterId/exception',
        () =>
          HttpResponse.json(
            { code: 'EXCEPTION_REJECTED', message: 'Approval rejected.' },
            { status: 400 },
          ),
      ),
      http.post('http://localhost/api/organization/exceptions/:exceptionId/revoke', () =>
        HttpResponse.json(
          { code: 'DECISION_REJECTED', message: 'Decision rejected.' },
          { status: 400 },
        ),
      ),
    )
    await expect(
      review.approveException({
        userId: 'candidate-user',
        characterId: 90_000_001,
        reason: 'Rejected request.',
        expiresAt: null,
      }),
    ).rejects.toThrow('Approval rejected.')
    await expect(
      review.decideException('exception-1', 'revoke', 'Rejected decision.'),
    ).rejects.toThrow('Decision rejected.')
    expect(review.errorMessage.value).toBe('Approval rejected.')
    expect(invalidateQueries).toHaveBeenCalledTimes(4)
    wrapper.unmount()
  })

  it('stops before private review queries without authentication or review capability', async () => {
    let contextRequests = 0
    let reviewRequests = 0
    queryServer.use(
      http.get('http://localhost/api/admin/setup', () =>
        HttpResponse.json({ required: false, available: true }),
      ),
      http.get('http://localhost/api/organization/context', () => {
        contextRequests += 1
        return HttpResponse.json(organizationContext(false))
      }),
      http.get('http://localhost/api/organization/exceptions', () => {
        reviewRequests += 1
        return HttpResponse.json({ reviewCandidates: [], exceptions: [] })
      }),
      http.get('http://localhost/api/organization/audit', () => {
        reviewRequests += 1
        return HttpResponse.json({ events: [], nextBeforeAuditSequence: null })
      }),
    )
    const initializeAuth = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    stubNuxtCompositionGlobals(initializeAuth)
    let review!: ReturnType<typeof useOrganizationHrReview>
    const Root = defineComponent({
      setup() {
        review = useOrganizationHrReview(apiClient)
        return () => h('span')
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await review.initialize()
    await review.initialize()
    review.loadOlderAuditEvents()
    await flushPromises()

    expect(contextRequests).toBe(1)
    expect(reviewRequests).toBe(0)
    expect(review.canReview.value).toBe(false)
    expect(review.auditEvents.value).toEqual([])
    wrapper.unmount()
  })
})

describe('organization roster coverage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('loads roster coverage for an authenticated reviewer', async () => {
    const coverage = {
      managedCorporations: { status: 'current' },
      corporations: [{ corporationId: 98_000_001, unregisteredCharacters: [] }],
    }
    queryServer.use(
      http.get('http://localhost/api/admin/setup', () =>
        HttpResponse.json({ required: false, available: true }),
      ),
      http.get('http://localhost/api/organization/context', () =>
        HttpResponse.json(organizationContext(true)),
      ),
      http.get('http://localhost/api/organization/roster-coverage', () =>
        HttpResponse.json(coverage),
      ),
    )
    const initializeAuth = vi.fn().mockResolvedValue(true)
    stubNuxtCompositionGlobals(initializeAuth)
    let roster!: ReturnType<typeof useOrganizationRosterCoverage>
    const Root = defineComponent({
      setup() {
        roster = useOrganizationRosterCoverage(apiClient)
        return () => h('span', roster.coverage.value?.corporations.length ?? 'loading')
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()
    await roster.initialize()
    await flushPromises()

    await vi.waitFor(() => expect(wrapper.text()).toBe('1'))
    expect(roster.coverage.value).toEqual(coverage)
    expect(roster.loading.value).toBe(false)
    expect(roster.errorMessage.value).toBe('')
    wrapper.unmount()
  })

  it('does not request organization context before deployment setup', async () => {
    let contextRequests = 0
    let coverageRequests = 0
    queryServer.use(
      http.get('http://localhost/api/admin/setup', () =>
        HttpResponse.json({ required: true, available: true }),
      ),
      http.get('http://localhost/api/organization/context', () => {
        contextRequests += 1
        return HttpResponse.json(organizationContext(false))
      }),
      http.get('http://localhost/api/organization/roster-coverage', () => {
        coverageRequests += 1
        return HttpResponse.json({ managedCorporations: {}, corporations: [] })
      }),
    )
    const initializeAuth = vi.fn().mockResolvedValue(true)
    stubNuxtCompositionGlobals(initializeAuth)
    let roster!: ReturnType<typeof useOrganizationRosterCoverage>
    const Root = defineComponent({
      setup() {
        roster = useOrganizationRosterCoverage(apiClient)
        return () => h('span')
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await roster.initialize()
    await flushPromises()

    expect(contextRequests).toBe(0)
    expect(coverageRequests).toBe(0)
    expect(roster.coverage.value).toBeUndefined()
    wrapper.unmount()
  })

  it('does not request roster coverage without review capability', async () => {
    let coverageRequests = 0
    queryServer.use(
      http.get('http://localhost/api/admin/setup', () =>
        HttpResponse.json({ required: false, available: true }),
      ),
      http.get('http://localhost/api/organization/context', () =>
        HttpResponse.json(organizationContext(false)),
      ),
      http.get('http://localhost/api/organization/roster-coverage', () => {
        coverageRequests += 1
        return HttpResponse.json({ managedCorporations: {}, corporations: [] })
      }),
    )
    const initializeAuth = vi.fn().mockResolvedValue(true)
    stubNuxtCompositionGlobals(initializeAuth)
    let roster!: ReturnType<typeof useOrganizationRosterCoverage>
    const Root = defineComponent({
      setup() {
        roster = useOrganizationRosterCoverage(apiClient)
        return () => h('span')
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await roster.initialize()
    await flushPromises()

    expect(coverageRequests).toBe(0)
    expect(roster.coverage.value).toBeUndefined()
    wrapper.unmount()
  })

  it('presents organization context failures', async () => {
    queryServer.use(
      http.get('http://localhost/api/admin/setup', () =>
        HttpResponse.json({ required: false, available: true }),
      ),
      http.get('http://localhost/api/organization/context', () =>
        HttpResponse.json(
          { code: 'ORGANIZATION_UNAVAILABLE', message: 'Organization context failed.' },
          { status: 403 },
        ),
      ),
    )
    const initializeAuth = vi.fn().mockResolvedValue(true)
    stubNuxtCompositionGlobals(initializeAuth)
    let roster!: ReturnType<typeof useOrganizationRosterCoverage>
    const Root = defineComponent({
      setup() {
        roster = useOrganizationRosterCoverage(apiClient)
        return () => h('span', roster.errorMessage.value)
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await roster.initialize()
    await flushPromises()

    await vi.waitFor(() => expect(wrapper.text()).toBe('Organization context failed.'))
    expect(roster.loading.value).toBe(false)
    wrapper.unmount()
  })
})

function stubNuxtCompositionGlobals(initializeAuth: () => Promise<boolean>) {
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useAuthSession', () => ({
    authSession: ref({ authenticated: true }),
    initializeAuth,
  }))
}

function organizationContext(canReview: boolean) {
  return {
    organization: {
      organizationType: 'corporation',
      organizationId: 98_000_001,
      organizationName: 'Example Corporation',
      organizationTicker: 'EX',
      organizationVersion: 1,
    },
    isOrganizationOwner: false,
    isBlocked: false,
    memberAccess: canReview,
    capabilities: {
      reviewRegistration: canReview,
      viewRosterCoverage: canReview,
    },
    claimAvailable: false,
    ownerStatus: 'fresh',
    reviewDeadline: null,
    authorityCharacter: null,
  }
}

function auditEvent(auditId: string) {
  return {
    auditId,
    auditSequence: auditId,
    organizationVersion: 1,
    policyVersion: 1,
    eventType: 'exception.approved',
    actorType: 'user',
    actorId: 'reviewer-user',
    subjectType: 'exception',
    subjectId: 'exception-1',
    reason: 'Reviewed.',
    outcome: 'granted',
    groupId: null,
    assignmentId: null,
    targetUserId: null,
    assignmentSource: null,
    complianceSource: null,
    entitlementExpiresAt: null,
    causationAuditId: null,
    occurredAt: '2026-09-08T10:00:00.000Z',
  }
}

function auditPage(auditIds: string[]) {
  return {
    events: auditIds.map(auditEvent),
    nextBeforeAuditSequence: null,
  }
}
