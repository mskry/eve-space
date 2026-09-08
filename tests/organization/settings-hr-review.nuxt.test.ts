import { mountSuspended } from '@nuxt/test-utils/runtime'
import { useQueryCache } from '@pinia/colada'
import { flushPromises } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import SettingsOrganizationHrReview from '../../app/components/settings/SettingsOrganizationHrReview.vue'
import type {
  OrganizationAudit,
  OrganizationContext,
  OrganizationExceptions,
} from '../../app/queries/organization'
import { PRIVATE_QUERY_KEYS } from '../../app/queries/query-keys'
import { queryServer } from '../support/query-server'

const mountedWrappers: { unmount: () => void }[] = []

beforeAll(() => queryServer.listen({ onUnhandledRequest: 'error' }))
afterAll(() => queryServer.close())

afterEach(async () => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
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
            userId: String(params.userId),
            reason: body.reason,
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
    expect(approvedRequest).toEqual({
      userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
      characterId: '90000002',
      reason: 'Approved from the review queue.',
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
          memberAccess: false,
          capabilities: { reviewRegistration: true, viewRosterCoverage: true },
        })
        return () => h(SettingsOrganizationHrReview)
      },
    })
    const wrapper = await mountSuspended(UnauthorizedHost, { route: false })
    mountedWrappers.push(wrapper)

    await vi.waitFor(() => expect(wrapper.text()).toContain('current HR auditor grant'))
    expect(privateRequests).toBe(0)
  })
})

function installCommonHandlers(canReview: boolean, memberAccess = canReview) {
  queryServer.use(
    http.get('*/auth/config', () =>
      HttpResponse.json({
        configured: true,
        loginUrl: '/auth/eve/login',
        attachUrl: '/auth/eve/attach',
      }),
    ),
    http.get('*/auth/session', () =>
      HttpResponse.json({
        authenticated: true,
        account: {
          userId: 'member-user',
          mainCharacter: { characterId: 1_404_328_063, name: 'Main Pilot' },
        },
      }),
    ),
    http.get('*/api/admin/setup', () => HttpResponse.json({ required: false, available: true })),
    http.get('*/api/organization/context', () =>
      HttpResponse.json({
        ...contextResponse,
        memberAccess,
        capabilities: { reviewRegistration: canReview, viewRosterCoverage: canReview },
      }),
    ),
    http.get('*/api/organization/exceptions', () => HttpResponse.json(exceptionResponse)),
    http.get('*/api/organization/audit', () => HttpResponse.json(auditResponse)),
  )
}

const contextResponse = {
  organization: {
    organizationType: 'corporation',
    organizationId: 98_000_001,
    organizationName: 'Example Corporation',
    organizationTicker: 'EX',
    organizationVersion: 1,
  },
  isOrganizationOwner: false,
  isBlocked: false,
  memberAccess: true,
  capabilities: { reviewRegistration: true, viewRosterCoverage: true },
  claimAvailable: false,
  ownerStatus: 'fresh',
  reviewDeadline: null,
  authorityCharacter: null,
} satisfies OrganizationContext

const exceptionResponse = {
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
} satisfies OrganizationExceptions

const auditResponse = {
  events: [
    {
      auditId: '35acd527-9539-44ad-aacf-9f8e45232267',
      auditSequence: '9',
      organizationVersion: 1,
      policyVersion: 2,
      eventType: 'exception.approved',
      actorType: 'user',
      actorId: 'db7121b5-a761-41e4-ba5d-217ed1b2fa38',
      subjectType: 'exception',
      subjectId: '22c7e94c-9cd3-4dc0-a3af-43117426ebec',
      reason: 'Approved external character.',
      outcome: 'granted',
      groupId: null,
      assignmentId: null,
      targetUserId: null,
      assignmentSource: null,
      complianceSource: null,
      entitlementExpiresAt: null,
      causationAuditId: null,
      occurredAt: '2026-09-08T10:00:00.000Z',
    },
  ],
  nextBeforeAuditSequence: null,
} satisfies OrganizationAudit
