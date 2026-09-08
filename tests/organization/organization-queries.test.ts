import { useQuery } from '@pinia/colada'
import { flushPromises } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  organizationActivitiesQuery,
  organizationAuditQuery,
  organizationComplianceQuery,
  organizationContextQuery,
  organizationExceptionsQuery,
  organizationRolesQuery,
  organizationRosterCoverageQuery,
  type OrganizationActivities,
  type OrganizationAudit,
  type OrganizationCompliance,
  type OrganizationContext,
  type OrganizationExceptions,
  type OrganizationRoles,
  type OrganizationRosterCoverage,
} from '../../app/queries/organization'
import { createApiClient } from '../../app/utils/api-client'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'
import { queryServer } from '../support/query-server'

const apiClient = createApiClient('http://localhost')

describe('organization queries', () => {
  it('loads member compliance through the private API query', async () => {
    const response = {
      organizationVersion: 1,
      state: 'compliant',
      evidenceFreshness: 'fresh',
      evidenceAt: '2026-09-08T10:00:00.000Z',
      reviewDeadline: null,
      accessValidUntil: null,
      evaluatedAt: '2026-09-08T10:00:00.000Z',
      accountReasons: [],
      remediationActions: [],
      characters: [
        {
          characterId: 1_404_328_063,
          characterName: 'Member Pilot',
          affiliationFreshness: 'fresh',
          affiliationCheckedAt: '2026-09-08T10:00:00.000Z',
          nextAffiliationCheck: '2026-09-08T11:00:00.000Z',
          reasons: [],
          remediationActions: [],
        },
      ],
      disclosureNotice:
        'EVE SSO authorizes one selected character at a time. Registration completeness depends on member disclosure and organization policy.',
    } satisfies OrganizationCompliance
    queryServer.use(
      http.get('http://localhost/api/organization/compliance', () => HttpResponse.json(response)),
    )
    const Root = defineComponent({
      setup() {
        const compliance = useQuery(organizationComplianceQuery(apiClient))
        return () => h('span', compliance.data.value?.state ?? 'loading')
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(wrapper.text()).toBe('compliant')
    wrapper.unmount()
  })

  it('loads prioritized member activities through the private API query', async () => {
    const response = {
      organizationVersion: 1,
      generatedAt: '2026-09-08T10:00:00.000Z',
      activities: [
        {
          id: 'organization-activity:project:17',
          sourceId: 'organization-activity:organization-activity',
          kind: 'corporation-project',
          title: 'Build the fleet reserve',
          summary: 'Deliver hulls before deployment.',
          requiredAction: {
            kind: 'delivery',
            label: 'Deliver requested hulls',
            characterId: 1_404_328_063,
          },
          organizationPriority: 100,
          deadline: '2026-09-09T18:00:00.000Z',
          eligibleCharacterIds: [1_404_328_063],
          participation: [{ characterId: 1_404_328_063, state: 'participating' }],
          linkTarget: {
            moduleId: 'organization-activity',
            pageId: 'organization-activity-projects',
            activityId: '98fa598d-8133-48e2-8329-aaaf0085b843',
            corporationId: 98_000_001,
            characterId: 1_404_328_063,
          },
          freshness: { state: 'current', collectedAt: '2026-09-08T09:55:00.000Z' },
        },
      ],
      sources: [
        {
          sourceId: 'organization-activity:organization-activity',
          moduleId: 'organization-activity',
          providerId: 'organization-activity',
          freshness: { state: 'current', collectedAt: '2026-09-08T09:55:00.000Z' },
        },
      ],
    } satisfies OrganizationActivities
    queryServer.use(
      http.get('http://localhost/api/organization/activities', () => HttpResponse.json(response)),
    )
    const Root = defineComponent({
      setup() {
        const activities = useQuery(organizationActivitiesQuery(apiClient))
        return () => h('span', activities.data.value?.activities[0]?.title ?? 'loading')
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(wrapper.text()).toBe('Build the fleet reserve')
    wrapper.unmount()
  })

  it('loads the private authority context', async () => {
    const response = {
      organization: {
        organizationType: 'corporation',
        organizationId: 98_000_001,
        organizationName: 'Example Corporation',
        organizationTicker: 'EX',
        organizationVersion: 1,
      },
      isOrganizationOwner: true,
      isBlocked: false,
      capabilities: { reviewRegistration: true, viewRosterCoverage: true },
      claimAvailable: false,
      ownerStatus: 'fresh',
      reviewDeadline: null,
      authorityCharacter: null,
    } satisfies OrganizationContext
    queryServer.use(
      http.get('http://localhost/api/organization/context', () => HttpResponse.json(response)),
    )
    const Root = defineComponent({
      setup() {
        const context = useQuery(organizationContextQuery(apiClient))
        return () => h('span', context.data.value?.organization.organizationName ?? 'loading')
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(wrapper.text()).toBe('Example Corporation')
    wrapper.unmount()
  })

  it('loads the owner-only role list', async () => {
    const response = {
      grants: [
        {
          grantId: '35acd527-9539-44ad-aacf-9f8e45232267',
          userId: '98a782d2-e042-47d7-9659-03b218121a1a',
          role: 'director',
          reason: 'Leadership duty.',
          grantedByUserId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
          grantedAt: '2026-08-31T12:00:00.000Z',
          mainCharacterId: 1_404_328_063,
          mainCharacterName: 'Director',
        },
      ],
    } satisfies OrganizationRoles
    queryServer.use(
      http.get('http://localhost/api/organization/roles', () => HttpResponse.json(response)),
    )
    const Root = defineComponent({
      setup() {
        const roles = useQuery(organizationRolesQuery(apiClient))
        return () => h('span', roles.data.value?.grants[0]?.mainCharacterName ?? 'loading')
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(wrapper.text()).toBe('Director')
    wrapper.unmount()
  })

  it('loads HR roster coverage through the private API query', async () => {
    const response = {
      managedCorporations: {
        status: 'current',
        validatedAt: '2026-09-01T10:00:00.000Z',
        attemptedAt: '2026-09-01T10:00:00.000Z',
        lastFailureClass: null,
      },
      corporations: [
        {
          organizationVersion: 1,
          corporationId: 98_000_001,
          managedLastObservedAt: '2026-09-01T10:00:00.000Z',
          source: {
            sourceId: 'd33bc7a7-d258-4057-bd86-b50a546d0680',
            characterId: 1_404_328_063,
          },
          status: 'current',
          validatedAt: '2026-09-01T10:00:00.000Z',
          attemptedAt: '2026-09-01T10:00:00.000Z',
          lastFailureClass: null,
          unregisteredCharacters: [
            { characterId: 90_000_001, observedAt: '2026-09-01T10:00:00.000Z' },
          ],
        },
      ],
    } satisfies OrganizationRosterCoverage
    queryServer.use(
      http.get('http://localhost/api/organization/roster-coverage', () =>
        HttpResponse.json(response),
      ),
    )
    const Root = defineComponent({
      setup() {
        const coverage = useQuery(organizationRosterCoverageQuery(apiClient))
        return () => h('span', coverage.data.value?.corporations[0]?.unregisteredCharacters.length)
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(wrapper.text()).toBe('1')
    wrapper.unmount()
  })

  it('loads HR exceptions and bounded audit history through private API queries', async () => {
    const exceptions = {
      reviewCandidates: [],
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
      ],
    } satisfies OrganizationExceptions
    const audit = {
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
    queryServer.use(
      http.get('http://localhost/api/organization/exceptions', () => HttpResponse.json(exceptions)),
      http.get('http://localhost/api/organization/audit', ({ request }) => {
        expect(new URL(request.url).searchParams.get('limit')).toBe('50')
        return HttpResponse.json(audit)
      }),
    )
    const Root = defineComponent({
      setup() {
        const exceptionQuery = useQuery(organizationExceptionsQuery(apiClient))
        const auditQuery = useQuery(organizationAuditQuery(apiClient))
        return () =>
          h(
            'span',
            `${exceptionQuery.data.value?.exceptions[0]?.characterName}:${auditQuery.data.value?.events[0]?.eventType}`,
          )
      },
    })

    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()

    expect(wrapper.text()).toBe('External Pilot:exception.approved')
    wrapper.unmount()
  })
})
