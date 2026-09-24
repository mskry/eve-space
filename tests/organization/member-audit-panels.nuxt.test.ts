import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import MemberAuditEvidencePanel from '../../features/member-audit/nuxt/src/runtime/app/reviewer/MemberAuditEvidencePanel.vue'
import MemberBlockPanel from '../../features/member-audit/nuxt/src/runtime/app/reviewer/member-block.vue'
import OrdinaryGroupsPanel from '../../features/member-audit/nuxt/src/runtime/app/reviewer/ordinary-groups.vue'

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
    expect(wrapper.get('output.member-audit-groups__result').text()).toContain(
      'Entitlements will be reevaluated by core',
    )
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

function successfulResponse() {
  return Promise.resolve(new Response(JSON.stringify({ decision: 'accepted' }), { status: 200 }))
}
