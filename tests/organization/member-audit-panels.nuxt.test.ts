import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { useQueryCache } from '@pinia/colada'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import MemberAuditEvidencePanel from '../../features/member-audit/nuxt/src/runtime/app/reviewer/MemberAuditEvidencePanel.vue'
import AssetsPanel from '../../features/member-audit/nuxt/src/runtime/app/reviewer/assets.vue'
import MailPanel from '../../features/member-audit/nuxt/src/runtime/app/reviewer/mail.vue'
import MemberBlockPanel from '../../features/member-audit/nuxt/src/runtime/app/reviewer/member-block.vue'
import OrdinaryGroupsPanel from '../../features/member-audit/nuxt/src/runtime/app/reviewer/ordinary-groups.vue'
import TrainedSkillsPanel from '../../features/member-audit/nuxt/src/runtime/app/reviewer/trained-skills.vue'
import WalletPanel from '../../features/member-audit/nuxt/src/runtime/app/reviewer/wallet.vue'

const mocks = vi.hoisted(() => ({
  assignGroup: vi.fn(),
  blockMember: vi.fn(),
  queryData: {} as Record<string, unknown>,
  refetch: vi.fn(),
  revokeGroup: vi.fn(),
  unblockMember: vi.fn(),
}))

mockNuxtImport('usePlatformProtectedQuery', () => (options: unknown) => {
  const resolved = typeof options === 'function' ? options() : options
  const routeId = (resolved as { routeId: string }).routeId
  return {
    data: ref(mocks.queryData[routeId]),
    error: ref<unknown>(),
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

const wrappers: { unmount(): void }[] = []
const currentStatus = (resourceId: string) => ({
  resourceId,
  status: 'current',
  validatedAt: '2026-09-19T08:00:00Z',
})

beforeEach(() => {
  mocks.queryData = {
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
  }
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
    mocks.queryData['wallet-detail'] = {
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
    }
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
    mocks.queryData['skills-detail'] = {
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
    }
    mocks.queryData['assets-detail'] = {
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
    }
    mocks.queryData['mail-detail'] = {
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
    }
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
      json: { reason: 'Immediate access review required.' },
      param: { userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    })
    expect(wrapper.get('output.member-audit-block__result').text()).toContain(
      'Protected organization access is denied immediately',
    )
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
