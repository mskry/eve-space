import { mountSuspended } from '@nuxt/test-utils/runtime'
import { RouterLinkStub } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import OrganizationComplianceDetails from '../../app/components/OrganizationComplianceDetails.vue'
import type { OrganizationCompliance } from '../../app/queries/organization'

describe('OrganizationComplianceDetails', () => {
  it.each([
    ['pending', 'Organization entitlements have not been granted.'],
    ['review_required', 'before the review period ends.'],
    ['suspended', 'Authentication and remediation remain available.'],
  ] as const)('explains the %s state', async (state, message) => {
    const wrapper = await mountCompliance({ ...complianceFixture, state })

    expect(wrapper.text()).toContain(message)
    expect(wrapper.text()).toContain(complianceFixture.disclosureNotice)
  })

  it('shows exact account and character findings for every attached character', async () => {
    const wrapper = await mountCompliance(complianceFixture)

    for (const label of [
      'No characters are attached',
      'Managed-organization evidence is unavailable',
      'No attached character belongs to the managed organization',
      'Character affiliation is unavailable',
      'Character affiliation is stale',
      'Character is outside the managed organization',
      'Character authorization is missing',
      'Required EVE authorization scope is missing',
    ]) {
      expect(wrapper.text()).toContain(label)
    }
    expect(wrapper.text()).toContain('esi-industry.read.v1')
    expect(wrapper.text()).toContain('Main Pilot')
    expect(wrapper.text()).toContain('External Pilot')
    expect(wrapper.findAll('.character-compliance__card')).toHaveLength(2)
    expect(wrapper.findAllComponents(RouterLinkStub).map((link) => link.props('to'))).toEqual([
      '/characters/1404328063',
      '/characters/90000002',
    ])
    expect(wrapper.get('.character-compliance__actions a').attributes('href')).toBe(
      'http://localhost:8788/auth/eve/reauthorize/1404328063',
    )
  })

  it('describes stale compliant state as retained rather than currently verified', async () => {
    const wrapper = await mountCompliance({
      ...complianceFixture,
      state: 'compliant',
      evidenceFreshness: 'stale',
    })

    expect(wrapper.text()).toContain('last verified compliant result')
    expect(wrapper.text()).toContain('Current affiliation has not been confirmed')
    expect(wrapper.text()).not.toContain('Compliance current')
    expect(wrapper.text()).not.toContain('currently satisfies')
  })
})

function mountCompliance(compliance: OrganizationCompliance) {
  return mountSuspended(OrganizationComplianceDetails, {
    props: { compliance, apiBase: 'http://localhost:8788' },
    global: { stubs: { NuxtLink: RouterLinkStub } },
    route: false,
  })
}

const complianceFixture = {
  organizationVersion: 1,
  state: 'review_required',
  evidenceFreshness: 'stale',
  evidenceAt: '2026-09-08T10:00:00.000Z',
  reviewDeadline: '2026-09-09T18:00:00.000Z',
  accessValidUntil: '2026-09-09T18:00:00.000Z',
  evaluatedAt: '2026-09-08T10:00:00.000Z',
  accountReasons: [
    { code: 'no-attached-characters' },
    { code: 'managed-corporation-evidence-unavailable' },
    { code: 'no-managed-organization-character' },
  ],
  remediationActions: [],
  characters: [
    {
      characterId: 1_404_328_063,
      characterName: 'Main Pilot',
      affiliationFreshness: 'stale',
      affiliationCheckedAt: '2026-09-08T10:00:00.000Z',
      nextAffiliationCheck: '2026-09-08T11:00:00.000Z',
      reasons: [
        { code: 'character-affiliation-unavailable', requiredScope: null },
        { code: 'character-affiliation-stale', requiredScope: null },
        { code: 'character-authorization-missing', requiredScope: null },
        { code: 'required-scope-missing', requiredScope: 'esi-industry.read.v1' },
      ],
      remediationActions: [
        {
          type: 'reauthorize-character',
          path: '/auth/eve/reauthorize/1404328063',
        },
      ],
    },
    {
      characterId: 90_000_002,
      characterName: 'External Pilot',
      affiliationFreshness: 'fresh',
      affiliationCheckedAt: '2026-09-08T10:00:00.000Z',
      nextAffiliationCheck: '2026-09-08T11:00:00.000Z',
      reasons: [{ code: 'character-outside-managed-organization', requiredScope: null }],
      remediationActions: [{ type: 'contact-organization-hr', path: null }],
    },
  ],
  disclosureNotice:
    'EVE SSO authorizes one selected character at a time. Registration completeness depends on member disclosure and organization policy.',
} satisfies OrganizationCompliance
