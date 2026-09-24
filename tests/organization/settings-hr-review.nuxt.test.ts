import { mountSuspended } from '@nuxt/test-utils/runtime'
import { useQueryCache } from '@pinia/colada'
import { flushPromises } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import SettingsOrganizationHrReview from '../../app/components/settings/SettingsOrganizationHrReview.vue'
import type {
  OrganizationAudit,
  OrganizationContext,
  OrganizationExceptions,
} from '../../app/queries/organization'
import { refreshPrivateAuthorization } from '../../app/queries/query-cache'
import { PRIVATE_QUERY_KEYS } from '../../app/queries/query-keys'
import { cacheAdmissionForOrganization } from '../support/cache-admission'
import { clearQueryCache } from '../support/clear-query-cache'
import { queryServer } from '../support/query-server'

const mountedWrappers: { unmount: () => void }[] = []

beforeAll(() => queryServer.listen({ onUnhandledRequest: 'error' }))
afterAll(() => queryServer.close())

beforeEach(clearQueryCache)

afterEach(async () => {
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount()
  }
  clearQueryCache()
  queryServer.resetHandlers()
  await flushPromises()
})

describe('SettingsOrganizationHrReview', () => {
  it('shows exception decisions and audit outcomes to HR', async () => {
    let approvedRequest: { characterId: string; userId: string; reason: string } | null = null
    installCommonHandlers(true)
    queryServer.use(
      http.post(
        '*/api/organization/members/:userId/characters/:characterId/exception',
        async ({ params, request }) => {
          const body = (await request.json()) as { reason: string }
          approvedRequest = {
            characterId: String(params.characterId),
            reason: body.reason,
            userId: String(params.userId),
          }
          return HttpResponse.json({ exception: { exceptionId: 'new-exception' } }, { status: 201 })
        },
      ),
    )

    const wrapper = await mountSuspended(SettingsOrganizationHrReview, { route: false })
    mountedWrappers.push(wrapper)

    await vi.waitFor(() => expect(wrapper.text()).toContain('Review Pilot'))

    expect(wrapper.text()).toContain('Awaiting exception review')
    expect(wrapper.text()).toContain('Approved external character.')
    expect(wrapper.text()).toContain('Expired Pilot')
    expect(wrapper.text()).toContain('1 active')
    expect(wrapper.findAll('.hr-review-row--decision > button')).toHaveLength(1)
    expect(wrapper.text()).toContain('exception.approved')
    expect(wrapper.text()).toContain('Actor: user / db7121b5-a761-41e4-ba5d-217ed1b2fa38')
    expect(wrapper.text()).toContain('Subject: exception / 22c7e94c-9cd3-4dc0-a3af-43117426ebec')
    expect(wrapper.text()).toContain('append-only')
    expect(wrapper.find('input[type="text"]').exists()).toBe(false)
    expect(wrapper.find('input[type="number"]').exists()).toBe(false)

    await wrapper.get('.hr-review-row--candidate > button').trigger('click')
    await wrapper.get('.hr-candidate-form textarea').setValue('Approved from the review queue.')
    await wrapper.get('.hr-candidate-form').trigger('submit')
    await vi.waitFor(() => expect(approvedRequest).not.toBeNull())
    expect(approvedRequest).toStrictEqual({
      characterId: '90000002',
      reason: 'Approved from the review queue.',
      userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
    })
  })

  it('does not request private HR resources without the exact capability', async () => {
    let privateRequests = 0
    installCommonHandlers(true, false)
    queryServer.use(
      http.get('*/api/organization/exceptions', () => {
        privateRequests += 1
        return HttpResponse.json(exceptionResponse)
      }),
      http.get('*/api/organization/audit', () => {
        privateRequests += 1
        return HttpResponse.json(auditResponse)
      }),
    )

    const UnauthorizedHost = defineComponent({
      setup() {
        useQueryCache().setQueryData(PRIVATE_QUERY_KEYS.organizationContext(), {
          ...contextResponse,
          capabilities: { reviewRegistration: true, viewRosterCoverage: true },
          memberAccess: false,
        })
        return () => h(SettingsOrganizationHrReview)
      },
    })
    const wrapper = await mountSuspended(UnauthorizedHost, { route: false })
    mountedWrappers.push(wrapper)

    await vi.waitFor(() => expect(wrapper.text()).toContain('current HR auditor grant'))
    expect(privateRequests).toBe(0)
  })

  it('clears open review forms on same-route organization invalidation', async () => {
    installCommonHandlers(true)
    const wrapper = await mountSuspended(SettingsOrganizationHrReview, { route: false })
    mountedWrappers.push(wrapper)
    await vi.waitFor(() => expect(wrapper.text()).toContain('Review Pilot'))
    await wrapper.get('.hr-review-row--candidate > button').trigger('click')
    await wrapper.get('.hr-candidate-form textarea').setValue('Private approval reason')
    await wrapper.get('.hr-review-row--decision > button').trigger('click')
    await wrapper.get('.hr-decision-form textarea').setValue('Private decision reason')

    await refreshPrivateAuthorization(useQueryCache(), { kind: 'organization' })
    await vi.waitFor(() => expect(wrapper.text()).toContain('Review Pilot'))

    expect(wrapper.find('.hr-candidate-form').exists()).toBe(false)
    expect(wrapper.find('.hr-decision-form').exists()).toBe(false)
    await wrapper.get('.hr-review-row--candidate > button').trigger('click')
    expect(wrapper.get('.hr-candidate-form textarea').element).toHaveProperty('value', '')
    await wrapper.get('.hr-review-row--decision > button').trigger('click')
    expect(wrapper.get('.hr-decision-form textarea').element).toHaveProperty('value', '')
  })
})

function installCommonHandlers(canReview: boolean, memberAccess = canReview) {
  queryServer.use(
    http.get('*/auth/config', () =>
      HttpResponse.json({
        attachUrl: '/auth/eve/attach',
        configured: true,
        loginUrl: '/auth/eve/login',
      }),
    ),
    http.get('*/auth/session', () =>
      HttpResponse.json({
        account: {
          mainCharacter: { characterId: 1_404_328_063, name: 'Main Pilot' },
          userId: 'member-user',
        },
        authenticated: true,
      }),
    ),
    http.get('*/api/me/cache-admission', () =>
      HttpResponse.json(cacheAdmissionForOrganization('member-user', 1_404_328_063)),
    ),
    http.get('*/api/admin/setup', () => HttpResponse.json({ available: true, required: false })),
    http.get('*/api/organization/context', () =>
      HttpResponse.json({
        ...contextResponse,
        capabilities: { reviewRegistration: canReview, viewRosterCoverage: canReview },
        memberAccess,
      }),
    ),
    http.get('*/api/organization/exceptions', () => HttpResponse.json(exceptionResponse)),
    http.get('*/api/organization/audit', () => HttpResponse.json(auditResponse)),
  )
}

const contextResponse = {
  authorityCharacter: null,
  capabilities: { reviewRegistration: true, viewRosterCoverage: true },
  claimAvailable: false,
  freshUntil: '2026-09-10T13:00:00.000Z',
  graceUntil: null,
  isBlocked: false,
  isOrganizationOwner: false,
  memberAccess: true,
  organization: {
    organizationId: 98_000_001,
    organizationName: 'Example Corporation',
    organizationTicker: 'EX',
    organizationType: 'corporation',
    organizationVersion: 1,
  },
  ownerFailureClass: null,
  ownerStatus: 'fresh',
  reviewDeadline: null,
} satisfies OrganizationContext

const exceptionResponse = {
  exceptions: [
    {
      exceptionId: '22c7e94c-9cd3-4dc0-a3af-43117426ebec',
      organizationVersion: 1,
      userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
      characterId: 90_000_001,
      characterName: 'External Pilot',
      approverUserId: 'db7121b5-a761-41e4-ba5d-217ed1b2fa38',
      reason: 'Approved external character.',
      approvedAt: '2026-09-08T10:00:00.000Z',
      expiresAt: null,
      expiredAt: null,
      revokedAt: null,
      revokedByUserId: null,
      revocationReason: null,
    },
    {
      exceptionId: '670fa8a7-b6ac-45be-b065-4427b9c91fbb',
      organizationVersion: 1,
      userId: 'f7b8554a-c5f4-4386-adc8-bba5e233b06a',
      characterId: 90_000_003,
      characterName: 'Expired Pilot',
      approverUserId: 'db7121b5-a761-41e4-ba5d-217ed1b2fa38',
      reason: 'Temporary approval.',
      approvedAt: '2020-01-01T10:00:00.000Z',
      expiresAt: '2020-01-02T10:00:00.000Z',
      expiredAt: null,
      revokedAt: null,
      revokedByUserId: null,
      revocationReason: null,
    },
  ],
  reviewCandidates: [
    {
      userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
      characterId: 90_000_002,
      characterName: 'Review Pilot',
      reasonCode: 'character-outside-managed-organization',
      state: 'review_required',
      evidenceFreshness: 'fresh',
      reviewDeadline: '2026-09-10T12:00:00.000Z',
      affiliationCheckedAt: '2026-09-08T12:00:00.000Z',
    },
  ],
} satisfies OrganizationExceptions

const auditResponse = {
  events: [
    {
      actorId: 'db7121b5-a761-41e4-ba5d-217ed1b2fa38',
      actorType: 'user',
      assignmentId: null,
      assignmentSource: null,
      auditId: '35acd527-9539-44ad-aacf-9f8e45232267',
      auditSequence: '9',
      causationAuditId: null,
      complianceSource: null,
      entitlementExpiresAt: null,
      eventType: 'exception.approved',
      groupId: null,
      occurredAt: '2026-09-08T10:00:00.000Z',
      organizationVersion: 1,
      outcome: 'granted',
      policyVersion: 2,
      reason: 'Approved external character.',
      subjectId: '22c7e94c-9cd3-4dc0-a3af-43117426ebec',
      subjectType: 'exception',
      targetUserId: null,
    },
  ],
  nextBeforeAuditSequence: null,
} satisfies OrganizationAudit
