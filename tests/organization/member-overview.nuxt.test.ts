import { mountSuspended } from '@nuxt/test-utils/runtime'
import { useQueryCache } from '@pinia/colada'
import { flushPromises, RouterLinkStub } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import MemberOverviewPage from '../../app/pages/index.vue'
import type { OrganizationActivities, OrganizationCompliance } from '../../app/queries/organization'
import { ADMIN_QUERY_KEYS } from '../../app/queries/query-keys'
import { queryServer } from '../support/query-server'

const mountedWrappers: { unmount: () => void }[] = []

beforeAll(() => queryServer.listen({ onUnhandledRequest: 'error' }))
afterAll(() => queryServer.close())

afterEach(async () => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  const queryCache = useQueryCache()
  queryCache.cancelQueries()
  for (const entry of queryCache.getEntries()) queryCache.remove(entry)
  queryServer.resetHandlers()
  await flushPromises()
})

describe('authenticated member overview', () => {
  it('prioritizes compliance, remediation, and eligible-character activity', async () => {
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
      http.get('*/api/admin/session', () => HttpResponse.json({ authenticated: false })),
      http.get('*/api/admin/setup', () => HttpResponse.json({ required: false, available: true })),
      http.get('*/api/modules', () =>
        HttpResponse.json({
          enabledModuleIds: ['organization-activity'],
          shellNavigationOrder: { dashboard: [], character: [] },
        }),
      ),
      http.get('*/api/organization/compliance', () => HttpResponse.json(complianceResponse)),
      http.get('*/api/organization/activities', () => HttpResponse.json(activityResponse)),
    )

    const wrapper = await mountSuspended(MemberOverviewPage, {
      global: { stubs: { NuxtLink: RouterLinkStub } },
      route: false,
    })
    mountedWrappers.push(wrapper)

    await vi.waitFor(() => expect(wrapper.text()).toContain('Build the fleet reserve'))

    expect(wrapper.text()).toContain('Review required')
    expect(wrapper.text()).toContain('9 Sept 2026, 18:00 UTC')
    expect(wrapper.text()).toContain('Reauthorize character')
    expect(wrapper.text()).toContain('Deliver requested hulls')
    expect(wrapper.text()).toContain('Manufacture strategic cruisers')
    expect(wrapper.text()).toContain('4 / 10')
    expect(wrapper.text()).toContain('1,250,000 ISK')
    expect(wrapper.text()).toContain('2 contributed')
    expect(wrapper.text()).toContain('Main Pilot')
    expect(wrapper.text()).toContain('Industry Pilot')
    expect(wrapper.text()).toContain('Some activity providers are delayed or unavailable')
    expect(wrapper.text()).toContain('secondary-provider')
    expect(wrapper.text()).toContain('STALE')
    expect(wrapper.text()).toContain('AUTHORIZATION REQUIRED')
    expect(wrapper.text()).not.toContain('Organization-wide')
    expect(wrapper.findAll('.activity-card').map((card) => card.get('h3').text())).toEqual([
      'Build the fleet reserve',
      'Monitor the campaign',
    ])
    expect(wrapper.find('.section-grid').exists()).toBe(false)
    expect(wrapper.find('.status-strip').exists()).toBe(false)
    expect(wrapper.get('.member-actions a').attributes('href')).toBe(
      'http://localhost:8788/auth/eve/reauthorize/1404328063',
    )
    await vi.waitFor(() => expect(wrapper.find('.activity-card__link').exists()).toBe(true))
    const activityLink = wrapper
      .findAllComponents(RouterLinkStub)
      .find((link) => link.classes().includes('activity-card__link'))
    expect(activityLink?.props('to')).toEqual({
      name: 'eve-organization-activity-projects',
      query: {
        activityId: '98fa598d-8133-48e2-8329-aaaf0085b843',
        corporationId: '98000001',
        characterId: '1404328063',
      },
    })
  })

  it('shows compliant activity while suppressing disabled-module detail actions', async () => {
    useOverviewHandlers('compliant', [])

    const wrapper = await mountSuspended(MemberOverviewPage, {
      global: { stubs: { NuxtLink: RouterLinkStub } },
      route: false,
    })
    mountedWrappers.push(wrapper)

    await vi.waitFor(() => expect(wrapper.text()).toContain('Build the fleet reserve'))

    expect(wrapper.text()).toContain('Compliant')
    expect(wrapper.text()).toContain('Deliver requested hulls')
    expect(wrapper.findAll('.activity-card')).toHaveLength(2)
    expect(wrapper.find('.activity-card__link').exists()).toBe(false)
    expect(wrapper.find('.section-grid').exists()).toBe(false)
    expect(wrapper.find('.status-strip').exists()).toBe(false)
  })

  it.each(['pending', 'suspended'] as const)(
    'withholds protected activity while %s and shows remediation',
    async (state) => {
      let activityRequests = 0
      useOverviewHandlers(state, ['organization-activity'], () => {
        activityRequests += 1
      })

      const wrapper = await mountSuspended(MemberOverviewPage, {
        global: { stubs: { NuxtLink: RouterLinkStub } },
        route: false,
      })
      mountedWrappers.push(wrapper)

      await vi.waitFor(() => expect(wrapper.text()).toContain('Registration action required'))

      expect(wrapper.text()).toContain(
        state === 'pending' ? 'Registration pending' : 'Access suspended',
      )
      expect(wrapper.text()).toContain(
        'Protected organization activity is withheld until member access is restored.',
      )
      expect(activityRequests).toBe(0)
      expect(wrapper.find('.activity-card').exists()).toBe(false)
    },
  )

  it('does not request organization context before deployment setup', async () => {
    let complianceRequests = 0
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
      http.get('*/api/admin/session', () => HttpResponse.json({ authenticated: false })),
      http.get('*/api/admin/setup', () => HttpResponse.json({ required: true, available: true })),
      http.get('*/api/organization/compliance', () => {
        complianceRequests += 1
        return HttpResponse.json(complianceResponse)
      }),
    )

    const SetupRequiredHost = defineComponent({
      setup() {
        useQueryCache().setQueryData(ADMIN_QUERY_KEYS.setup, { required: true, available: true })
        return () => h(MemberOverviewPage)
      },
    })
    const wrapper = await mountSuspended(SetupRequiredHost, {
      global: { stubs: { NuxtLink: RouterLinkStub } },
      route: false,
    })
    mountedWrappers.push(wrapper)

    await vi.waitFor(() => expect(wrapper.text()).toContain('Configure the managed organization'))

    expect(complianceRequests).toBe(0)
    expect(wrapper.getComponent(RouterLinkStub).props('to')).toBe('/admin/login')
  })
})

function useOverviewHandlers(
  state: OrganizationCompliance['state'],
  enabledModuleIds: readonly string[],
  onActivityRequest?: () => void,
) {
  const compliance = {
    ...complianceResponse,
    state,
    reviewDeadline: state === 'review_required' ? complianceResponse.reviewDeadline : null,
    accessValidUntil: state === 'review_required' ? complianceResponse.accessValidUntil : null,
    characters:
      state === 'compliant'
        ? complianceResponse.characters.map((character) => ({
            ...character,
            reasons: [],
            remediationActions: [],
          }))
        : complianceResponse.characters,
  }
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
    http.get('*/api/admin/session', () => HttpResponse.json({ authenticated: false })),
    http.get('*/api/admin/setup', () => HttpResponse.json({ required: false, available: true })),
    http.get('*/api/modules', () =>
      HttpResponse.json({
        enabledModuleIds,
        shellNavigationOrder: { dashboard: [], character: [] },
      }),
    ),
    http.get('*/api/organization/compliance', () => HttpResponse.json(compliance)),
    http.get('*/api/organization/activities', () => {
      onActivityRequest?.()
      return HttpResponse.json(activityResponse)
    }),
  )
}

const complianceResponse = {
  organizationVersion: 1,
  state: 'review_required',
  evidenceFreshness: 'fresh',
  evidenceAt: '2026-09-08T10:00:00.000Z',
  reviewDeadline: '2026-09-09T18:00:00.000Z',
  accessValidUntil: '2026-09-09T18:00:00.000Z',
  evaluatedAt: '2026-09-08T10:00:00.000Z',
  accountReasons: [],
  remediationActions: [],
  characters: [
    {
      characterId: 1_404_328_063,
      characterName: 'Main Pilot',
      affiliationFreshness: 'fresh',
      affiliationCheckedAt: '2026-09-08T10:00:00.000Z',
      nextAffiliationCheck: '2026-09-08T11:00:00.000Z',
      reasons: [{ code: 'required-scope-missing', requiredScope: 'esi-industry.read.v1' }],
      remediationActions: [
        {
          type: 'reauthorize-character',
          path: '/auth/eve/reauthorize/1404328063',
        },
      ],
    },
    {
      characterId: 90_000_002,
      characterName: 'Industry Pilot',
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

const activityResponse = {
  organizationVersion: 1,
  generatedAt: '2026-09-08T10:00:00.000Z',
  activities: [
    {
      id: 'organization-activity:project:17',
      sourceId: 'organization-activity:organization-activity',
      kind: 'corporation-project',
      title: 'Build the fleet reserve',
      summary: 'Deliver hulls before deployment.',
      objective: 'Manufacture strategic cruisers',
      state: 'Active',
      progress: { current: 4, desired: 10 },
      reward: { initial: 2_000_000, remaining: 1_250_000 },
      requiredAction: {
        kind: 'delivery',
        label: 'Deliver requested hulls',
        characterId: 1_404_328_063,
      },
      organizationPriority: 100,
      deadline: '2026-09-09T18:00:00.000Z',
      eligibleCharacterIds: [1_404_328_063, 90_000_002],
      participation: [
        { characterId: 1_404_328_063, state: 'participating', contribution: 2 },
        { characterId: 90_000_002, state: 'eligible', contribution: null },
      ],
      linkTarget: {
        moduleId: 'organization-activity',
        pageId: 'organization-activity-projects',
        activityId: '98fa598d-8133-48e2-8329-aaaf0085b843',
        corporationId: 98_000_001,
        characterId: 1_404_328_063,
      },
      freshness: { state: 'current', collectedAt: '2026-09-08T09:55:00.000Z' },
    },
    {
      id: 'organization-activity:campaign:22',
      sourceId: 'organization-activity:organization-activity',
      kind: 'military-campaign',
      title: 'Monitor the campaign',
      summary: null,
      objective: null,
      state: 'Active',
      progress: { current: 0.4, desired: 1 },
      reward: null,
      requiredAction: null,
      organizationPriority: 20,
      deadline: null,
      eligibleCharacterIds: [],
      participation: [
        { characterId: 90_000_002, state: 'authorization-required', contribution: null },
      ],
      linkTarget: null,
      freshness: { state: 'stale', collectedAt: '2026-09-08T08:55:00.000Z' },
    },
  ],
  sources: [
    {
      sourceId: 'secondary:secondary-provider',
      moduleId: 'secondary',
      providerId: 'secondary-provider',
      freshness: { state: 'unavailable', collectedAt: null },
    },
    {
      sourceId: 'organization-activity:organization-activity',
      moduleId: 'organization-activity',
      providerId: 'organization-activity',
      freshness: { state: 'current', collectedAt: '2026-09-08T09:55:00.000Z' },
    },
  ],
} satisfies OrganizationActivities
