import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { useQueryCache } from '@pinia/colada'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import MemberAuditEvidencePanel from '../../features/member-audit/nuxt/src/runtime/app/reviewer/MemberAuditEvidencePanel.vue'
import MemberAuditCharacterOverviewPanel from '../../features/member-audit/nuxt/src/runtime/app/reviewer/MemberAuditCharacterOverviewPanel.vue'
import MemberAuditCurrentObservationPanel from '../../features/member-audit/nuxt/src/runtime/app/reviewer/MemberAuditCurrentObservationPanel.vue'
import AssetsPanel from '../../features/member-audit/nuxt/src/runtime/app/reviewer/assets.vue'
import MailPanel from '../../features/member-audit/nuxt/src/runtime/app/reviewer/mail.vue'
import MemberBlockPanel from '../../features/member-audit/nuxt/src/runtime/app/reviewer/member-block.vue'
import OrdinaryGroupsPanel from '../../features/member-audit/nuxt/src/runtime/app/reviewer/ordinary-groups.vue'
import TrainedSkillsPanel from '../../features/member-audit/nuxt/src/runtime/app/reviewer/trained-skills.vue'
import WalletPanel from '../../features/member-audit/nuxt/src/runtime/app/reviewer/wallet.vue'

const mocks = vi.hoisted(() => ({
  assignGroup: vi.fn(),
  blockMember: vi.fn(),
  invalidateReviewerAction: vi.fn().mockResolvedValue(undefined),
  queryData: new Map<string, object>(),
  queryErrors: new Map<string, Error>(),
  refetch: vi.fn(),
  revokeGroup: vi.fn(),
  unblockMember: vi.fn(),
}))

vi.mock('@eve-space/platform-module-nuxt/runtime', async (importOriginal) => ({
  ...(await importOriginal()),
  usePlatformReviewerActionInvalidation: () => mocks.invalidateReviewerAction,
}))

mockNuxtImport('usePlatformProtectedQuery', () => (options: unknown) => {
  const resolved = typeof options === 'function' ? options() : options
  const routeId = (resolved as { routeId: string }).routeId
  return {
    data: ref(mocks.queryData.get(routeId)),
    error: ref<unknown>(mocks.queryErrors.get(routeId)),
    refetch: mocks.refetch,
    status: ref('success'),
  }
})

mockNuxtImport('usePlatformApi', () => () => ({
  api: {
    modules: {
      'member-audit': {
        accounts: {
          ':userId': {
            block: {
              $delete: mocks.unblockMember,
              $get: vi.fn(),
              $post: mocks.blockMember,
            },
            groups: {
              $get: vi.fn(),
              ':groupId': {
                $post: mocks.assignGroup,
                assignments: { ':assignmentId': { $delete: mocks.revokeGroup } },
              },
            },
          },
        },
      },
    },
  },
}))
mockNuxtImport('usePlatformCharacterProfile', () => () => ({
  props: ['profile', 'state'],
  template: '<div class="fixture-profile-presenter">{{ profile ? profile.name : state }}</div>',
}))

const wrappers: { unmount(): void }[] = []
const currentStatus = (resourceId: string) => ({
  resourceId,
  status: 'current',
  validatedAt: '2026-09-19T08:00:00Z',
})

beforeEach(() => {
  mocks.queryErrors.clear()
  mocks.queryData = new Map(
    Object.entries({
      'block-actions': { block: { blocked: false } },
      'group-actions': {
        groups: [
          {
            assignmentId: '11111111-1111-4111-8111-111111111111',
            groupId: '22222222-2222-4222-8222-222222222222',
            managementMode: 'compliance',
            name: 'Registration compliant',
            readOnly: true,
          },
          {
            assignmentId: '33333333-3333-4333-8333-333333333333',
            groupId: '44444444-4444-4444-8444-444444444444',
            managementMode: 'manual',
            name: 'Fleet access',
            readOnly: false,
          },
        ],
      },
    }),
  )
  mocks.assignGroup.mockImplementation(successfulResponse)
  mocks.blockMember.mockImplementation(successfulResponse)
  mocks.refetch.mockResolvedValue(undefined)
  mocks.revokeGroup.mockImplementation(successfulResponse)
  mocks.unblockMember.mockImplementation(successfulResponse)
})

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) {
    wrapper.unmount()
  }
  vi.clearAllMocks()
})

describe('Member Audit reviewer panels', () => {
  it('renders exact-character public profile without owner controls', async () => {
    mocks.queryData.set('character-overview', {
      profile: { id: 90_000_001, name: 'Reviewed Character' },
    })
    const wrapper = await mountSuspended(MemberAuditCharacterOverviewPanel, {
      attachTo: document.body,
      props: {
        ...characterProps('character-landing-profile', 'character-overview'),
        sectionId: 'overview',
      },
      route: false,
    })
    wrappers.push(wrapper)
    expect(wrapper.text()).toContain('Reviewed Character')
    expect(wrapper.find('.platform-resource-retained').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/send mail|detach|transfer|set main/i)
  })

  it.each([
    { refreshFailureClass: 'esi-cooldown', reason: 'ESI refresh is on cooldown.' },
    { refreshFailureClass: 'esi-unavailable', reason: 'ESI is unavailable.' },
    { refreshFailureClass: 'response-invalid', reason: 'ESI returned an invalid response.' },
    { refreshFailureClass: undefined, reason: 'The latest refresh failed.' },
  ])(
    'discloses cached profile provenance for $refreshFailureClass',
    async ({ refreshFailureClass, reason }) => {
      const validatedAt = '2026-09-19T08:00:00Z'
      const retryAt = '2026-09-19T09:00:00Z'
      mocks.queryData.set('character-overview', {
        profile: {
          id: 90_000_001,
          name: 'Reviewed Character',
          stale: true,
          validatedAt,
          retryAt,
          refreshFailureClass,
        },
      })
      const wrapper = await mountSuspended(MemberAuditCharacterOverviewPanel, {
        props: {
          ...characterProps('character-landing-profile', 'character-overview'),
          sectionId: 'overview',
        },
        route: false,
      })
      wrappers.push(wrapper)

      expect(wrapper.get('.fixture-profile-presenter').text()).toBe('Reviewed Character')
      const warning = wrapper.get('.platform-resource-retained')
      expect(warning.text()).toContain('Showing a stale cached public profile.')
      expect(warning.text()).toContain(reason)
      expect(warning.text()).toContain(`Last validated at ${validatedAt}`)
      expect(warning.get('time').attributes('datetime')).toBe(retryAt)
      await warning.get('button').trigger('click')
      expect(mocks.refetch).toHaveBeenCalledOnce()

      await wrapper.setProps({
        queryAccess: { authenticated: true, authorized: false, moduleEnabled: true },
      })
      expect(wrapper.text()).toContain('Your current organization authority does not permit')
      expect(wrapper.text()).not.toContain('Showing a stale cached public profile.')
    },
  )

  it('keeps a current ship usable when location authorization is required', async () => {
    const validatedAt = new Date().toISOString()
    const cachedUntil = new Date(Date.now() + 60_000).toISOString()
    mocks.queryData.set('current-observation-detail', {
      currentShip: {
        status: { resourceId: 'current-ship', status: 'current', validatedAt, cachedUntil },
        evidence: {
          snapshot: {
            kind: 'current-ship',
            typeId: 34,
            typeName: 'Merlin',
            groupName: 'Frigate',
            name: 'Review Vessel',
          },
        },
      },
      currentLocation: {
        status: {
          resourceId: 'current-location',
          status: 'authorization-required',
          validatedAt: null,
          cachedUntil: null,
          requiredScope: 'esi-location.read_location.v1',
        },
        evidence: null,
      },
    })
    const wrapper = await mountSuspended(MemberAuditCurrentObservationPanel, {
      attachTo: document.body,
      props: {
        ...characterProps('current-observation', 'current-observation-detail'),
        sectionId: 'current-observation',
      },
      route: false,
    })
    wrappers.push(wrapper)
    expect(wrapper.text()).toContain('Review Vessel')
    expect(wrapper.text()).toContain('Merlin')
    expect(wrapper.text()).toContain('Character authorization required')
    expect(wrapper.text()).toContain('Upstream expiry')
    expect(wrapper.text()).not.toContain('solarSystemId')
  })

  it('keeps current-location evidence when ship collection and public profile fail independently', async () => {
    const validatedAt = new Date().toISOString()
    const cachedUntil = new Date(Date.now() + 60_000).toISOString()
    mocks.queryErrors.set('character-overview', new Error('Public profile is unavailable.'))
    mocks.queryData.set('current-observation-detail', {
      currentShip: {
        status: {
          resourceId: 'current-ship',
          status: 'unavailable',
          validatedAt: null,
          cachedUntil: null,
        },
        evidence: null,
      },
      currentLocation: {
        status: { resourceId: 'current-location', status: 'current', validatedAt, cachedUntil },
        evidence: {
          snapshot: { kind: 'current-location', solarSystemName: 'Amarr', locationType: 'space' },
        },
      },
    })
    const profile = await mountSuspended(MemberAuditCharacterOverviewPanel, {
      attachTo: document.body,
      props: {
        ...characterProps('character-landing-profile', 'character-overview'),
        sectionId: 'overview',
      },
      route: false,
    })
    wrappers.push(profile)
    const observation = await mountSuspended(MemberAuditCurrentObservationPanel, {
      attachTo: document.body,
      props: {
        ...characterProps('current-observation', 'current-observation-detail'),
        sectionId: 'current-observation',
      },
      route: false,
    })
    wrappers.push(observation)
    expect(profile.text()).toContain('Public profile is unavailable')
    expect(observation.text()).toContain('Amarr')
    expect(observation.text()).toContain('Evidence is unavailable')
  })
  it('presents authorization and current-empty evidence as distinct accessible states', async () => {
    const wrapper = await mountSuspended(MemberAuditEvidencePanel, {
      attachTo: document.body,
      props: {
        description: 'Current asset evidence.',
        evidence: null,
        hasEvidence: false,
        permission: 'member-audit.assets.read',
        state: {
          message: 'The character owner must renew authorization.',
          status: 'authorization-required',
          title: 'Character authorization required',
        },
        statuses: [
          {
            resourceId: 'assets',
            status: 'authorization-required',
            validatedAt: null,
          },
        ],
        target: 'Character 90000001',
        title: 'Assets',
      },
    })
    wrappers.push(wrapper)

    expect(wrapper.text()).toContain('Character authorization required')
    expect(wrapper.text()).toContain('Validated: never')

    await wrapper.setProps({
      state: { status: 'ready' },
      statuses: [{ resourceId: 'assets', status: 'current', validatedAt: '2026-09-19T08:00:00Z' }],
    })

    expect(wrapper.get('output').text()).toContain(
      'current complete observation contains no records',
    )
    expect(wrapper.get('time').attributes('datetime')).toBe('2026-09-19T08:00:00Z')
  })

  it('keeps compliance groups read-only and requires confirmed reasons for ordinary changes', async () => {
    const wrapper = await mountSuspended(OrdinaryGroupsPanel, {
      attachTo: document.body,
      props: reviewerProps('ordinary-groups', 'group-actions', 'access-management'),
      route: false,
    })
    wrappers.push(wrapper)
    const invalidateQueries = vi.spyOn(useQueryCache(), 'invalidateQueries')
    const revokeButtons = wrapper.findAll('.member-audit-groups__list button')

    expect(revokeButtons).toHaveLength(2)
    expect(revokeButtons[0]!.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Compliance-managed and restricted groups are read-only')

    await wrapper.get('#member-audit-group-id').setValue('55555555-5555-4555-8555-555555555555')
    await wrapper.get('#member-audit-group-reason').setValue('Approved for fleet operations.')
    await wrapper.get('.member-audit-groups__confirmation input').setValue(true)
    await wrapper.get('.member-audit-groups__form').trigger('submit')
    await flushPromises()

    expect(mocks.assignGroup).toHaveBeenCalledWith({
      json: { expiresAt: null, reason: 'Approved for fleet operations.' },
      param: {
        groupId: '55555555-5555-4555-8555-555555555555',
        userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    })
    expect(mocks.refetch).toHaveBeenCalledOnce()
    expect(invalidateQueries).toHaveBeenCalledWith({
      key: ['private', 'organization', 'reviewer', 7],
    })
    expect(wrapper.get('output.member-audit-groups__result').text()).toContain(
      'Entitlements will be reevaluated by core',
    )
  })

  it('presents independent wallet records when balance collection is unavailable', async () => {
    mocks.queryData.set('wallet-detail', {
      previewLimit: 500,
      balance: {
        evidence: null,
        status: { resourceId: 'wallet-balance', status: 'unavailable', validatedAt: null },
      },
      journal: {
        evidence: [{ journalId: 12, amount: 4200, date: '2026-09-19', referenceType: 'Bounty' }],
        status: {
          resourceId: 'wallet-journal',
          status: 'current',
          validatedAt: '2026-09-19T08:00:00Z',
        },
      },
      transactions: {
        evidence: [
          { transactionId: 1, isBuy: true, typeName: 'Rifter', quantity: 2, unitPrice: 1000 },
          { transactionId: 2, isBuy: false, typeName: 'Venture', quantity: 1, unitPrice: 2500 },
        ],
        status: {
          resourceId: 'wallet-transactions',
          status: 'current',
          validatedAt: '2026-09-19T08:00:00Z',
        },
      },
    })
    const wrapper = await mountSuspended(WalletPanel, {
      props: characterProps('wallet', 'wallet-detail'),
      route: false,
    })
    wrappers.push(wrapper)

    expect(wrapper.text()).toContain('4,200 ISK')
    expect(wrapper.text()).toContain('Balance evidence is not currently available')
    expect(wrapper.text()).toContain('at most the 500 most recent retained journal records')
    const transactionTitles = wrapper.findAll('.member-audit-wallet__entry strong')
    expect(transactionTitles[1]?.text()).toContain('Buy · Rifter')
    expect(transactionTitles[2]?.text()).toContain('Sell · Venture')
    expect(wrapper.find('pre').exists()).toBe(false)
  })

  it('presents skill, asset, and sanitized mail evidence without JSON payloads', async () => {
    mocks.queryData.set('skills-detail', {
      trainedSkills: {
        status: currentStatus('trained-skills'),
        evidence: {
          snapshot: {
            groups: [
              {
                groupId: 1,
                name: 'Navigation',
                trainedSp: 900,
                skills: [
                  {
                    typeId: 4,
                    name: 'Astrometrics',
                    trainedLevel: 3,
                    activeLevel: 3,
                    skillpoints: 900,
                  },
                ],
              },
            ],
            totalSp: 900,
            injectedSkillCount: 1,
            unallocatedSp: 0,
          },
        },
      },
    })
    mocks.queryData.set('assets-detail', {
      assets: {
        status: currentStatus('assets'),
        evidence: {
          snapshot: {
            records: [
              {
                itemId: 1,
                typeName: 'Rifter',
                quantity: 2,
                locationName: 'Jita IV',
                totalVolume: 500,
              },
            ],
          },
        },
      },
    })
    mocks.queryData.set('mail-detail', {
      previewLimit: 500,
      headers: {
        status: currentStatus('mail-headers'),
        evidence: [
          {
            mailId: 8,
            subject: 'Flight plan',
            senderName: 'Pilot',
            recipientNames: ['Wingmate'],
            sentAt: '2026-09-19',
          },
        ],
      },
      details: {
        status: currentStatus('mail-details'),
        evidence: [
          {
            mailId: 8,
            subject: 'Flight plan',
            senderName: 'Pilot',
            sentAt: '2026-09-19',
            body: 'Meet at the gate.',
          },
        ],
      },
    })
    for (const [panel, contributionId, routeId] of [
      [TrainedSkillsPanel, 'trained-skills', 'skills-detail'],
      [AssetsPanel, 'assets', 'assets-detail'],
      [MailPanel, 'mail', 'mail-detail'],
    ] as const) {
      const wrapper = await mountSuspended(panel, {
        props: characterProps(contributionId, routeId),
        route: false,
      })
      wrappers.push(wrapper)
      expect(wrapper.find('pre').exists()).toBe(false)
    }
    expect(wrappers.at(-3)?.text()).toContain('Astrometrics')
    expect(wrappers.at(-2)?.text()).toContain('Rifter')
    expect(wrappers.at(-1)?.text()).toContain('Meet at the gate.')
  })

  it('drops an obsolete block response after the selected target changes', async () => {
    let complete!: (response: Response) => void
    mocks.blockMember.mockReturnValue(
      new Promise<Response>((resolve) => {
        complete = resolve
      }),
    )
    const wrapper = await mountSuspended(MemberBlockPanel, {
      props: reviewerProps('member-block', 'block-actions', 'access-management'),
      route: false,
    })
    wrappers.push(wrapper)
    await wrapper.get('#member-audit-block-reason').setValue('Review access.')
    await wrapper.get('.member-audit-block__confirmation input').setValue(true)
    await wrapper.get('.member-audit-block__form').trigger('submit')
    await wrapper.get('.member-audit-block__form').trigger('submit')
    expect(mocks.blockMember).toHaveBeenCalledOnce()

    await wrapper.setProps({
      target: {
        ...reviewerProps('member-block', 'block-actions', 'access-management').target,
        userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
    })
    complete(new Response(JSON.stringify({ decision: 'blocked' }), { status: 200 }))
    await flushPromises()

    expect(wrapper.find('output.member-audit-block__result').exists()).toBe(false)
    expect(mocks.refetch).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'reviewer permission',
      props: { queryAccess: { authenticated: true, authorized: false, moduleEnabled: true } },
    },
    {
      name: 'access-management enablement',
      props: { queryAccess: { authenticated: true, authorized: true, moduleEnabled: false } },
    },
    { name: 'organization version', props: { organizationVersion: 8 } },
    {
      name: 'managed-member lifecycle',
      props: {
        target: {
          ...reviewerProps('member-block', 'block-actions', 'access-management').target,
          managedMemberLifecycleId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        },
      },
    },
  ])('discards a pending account confirmation on $name change', async ({ props }) => {
    const wrapper = await mountSuspended(MemberBlockPanel, {
      props: reviewerProps('member-block', 'block-actions', 'access-management'),
      route: false,
    })
    wrappers.push(wrapper)
    await wrapper.get('#member-audit-block-reason').setValue('Account-wide review hold.')
    await wrapper.get('.member-audit-block__confirmation input').setValue(true)
    await wrapper.setProps(props)
    expect(wrapper.get<HTMLTextAreaElement>('#member-audit-block-reason').element.value).toBe('')
    expect(
      wrapper.get<HTMLInputElement>('.member-audit-block__confirmation input').element.checked,
    ).toBe(false)
    await wrapper.get('.member-audit-block__form').trigger('submit')
    expect(mocks.blockMember).not.toHaveBeenCalled()
  })

  it('requires confirmation before applying the immediate member block', async () => {
    const wrapper = await mountSuspended(MemberBlockPanel, {
      attachTo: document.body,
      props: reviewerProps('member-block', 'block-actions', 'access-management'),
      route: false,
    })
    wrappers.push(wrapper)
    const submit = wrapper.get('.member-audit-block__form button')

    expect(submit.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('immediately denies protected organization access')
    await wrapper.get('#member-audit-block-reason').setValue('Immediate access review required.')
    await wrapper.get('.member-audit-block__confirmation input').setValue(true)
    await wrapper.get('.member-audit-block__form').trigger('submit')
    await flushPromises()

    expect(mocks.blockMember).toHaveBeenCalledWith({
      json: {
        reason: 'Immediate access review required.',
        expectedOrganizationVersion: 7,
        expectedManagedMemberLifecycleId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
      param: { userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    })
    expect(wrapper.get('output.member-audit-block__result').text()).toContain(
      'Protected organization access is denied immediately',
    )
    expect(mocks.invalidateReviewerAction).toHaveBeenCalledOnce()
  })
})

function reviewerProps(contributionId: string, routeId: string, sectionId: string) {
  return {
    contributionId,
    moduleId: 'member-audit',
    organizationVersion: 7,
    queryAccess: { authenticated: true, authorized: true, moduleEnabled: true },
    routeId,
    sectionId,
    target: {
      kind: 'managed-organization-account' as const,
      managedMemberLifecycleId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      sectionActivationVersion: 1,
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
  }
}

function characterProps(contributionId: string, routeId: string) {
  const props = reviewerProps(
    contributionId,
    routeId,
    contributionId === 'trained-skills' ? 'skills' : contributionId,
  )
  return {
    ...props,
    target: {
      ...props.target,
      kind: 'managed-organization-character' as const,
      characterId: 90_000_001,
      characterLifecycleId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      authorizationGeneration: 3,
      disclosureVersion: 1,
    },
  }
}

function successfulResponse() {
  return Promise.resolve(new Response(JSON.stringify({ decision: 'accepted' }), { status: 200 }))
}
