import { mountSuspended } from '@nuxt/test-utils/runtime'
import { nextTick, defineComponent, h, type PropType } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import OrganizationReviewDirectory from '../../app/components/organization-review/OrganizationReviewDirectory.vue'
import { ORGANIZATION_REVIEW_DIRECTORY_COLUMN_PREFERENCE_STORAGE_KEY } from '../../app/composables/useOrganizationReviewDirectoryColumnPreferences'
import type { OrganizationReviewDirectoryMember } from '../../app/queries/organization-review'
import type { OrganizationReviewDirectoryPreference } from '../../app/utils/organization-review-directory-fields'

const mountedWrappers: { unmount(): void }[] = []

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount()
  }
  localStorage.clear()
})

describe('organization review directory', () => {
  it('renders the canonical default fields as a semantic selectable table', async () => {
    const wrapper = await mountDirectory({
      hasPreviousPage: true,
      members: [directoryMember(), directoryMember({ secondary: true })],
      page: 2,
      selectedUserId: directoryMember().account.userId,
    })

    expect(wrapper.get('table').attributes('aria-busy')).toBe('false')
    expect(wrapper.get('caption').text()).toContain('Current managed organization accounts')
    expect(headerLabels(wrapper)).toStrictEqual([
      'Member',
      'Corporation',
      'Managed since',
      'Audit data',
      'Groups',
      'Access status',
      'Actions',
    ])
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
    expect(wrapper.get('tbody tr.is-selected').text()).toContain('Selected member')
    expect(
      wrapper.get('button[aria-label="Selected member Review Pilot"]').attributes('aria-pressed'),
    ).toBe('true')
    expect(
      wrapper
        .findAll('time')
        .some((time) => time.attributes('datetime') === '2026-01-01T00:00:00.000Z'),
    ).toBe(true)
    expect(wrapper.text()).toContain('Current')
    expect(wrapper.text()).toContain('7 of 7 covered')
    expect(wrapper.text()).toContain('Compliant')
    expect(wrapper.text()).toContain('+2')
    expect(wrapper.get('output[aria-live="polite"]').text()).toBe('Page 2, 2 managed members.')
    for (const forbidden of [
      'CSV',
      'raw evidence',
      'access token',
      'refresh token',
      'undisclosed character',
      'last site activity',
      'last site login',
      'last EVE login',
    ]) {
      expect(wrapper.text()).not.toContain(forbidden)
    }
  })

  it('restores, changes, reorders, and resets only stable column identities', async () => {
    const storedPreference = {
      fieldIds: ['site_registered_at', 'disclosed_characters'],
      version: 1,
    } satisfies OrganizationReviewDirectoryPreference
    localStorage.setItem(
      ORGANIZATION_REVIEW_DIRECTORY_COLUMN_PREFERENCE_STORAGE_KEY,
      JSON.stringify(storedPreference),
    )
    const wrapper = await mountDirectory()

    expect(headerLabels(wrapper)).toStrictEqual([
      'Member',
      'Site registered',
      'Disclosed characters',
      'Actions',
    ])
    expect(wrapper.get('#review-directory-column-member').attributes()).toHaveProperty('disabled')
    expect(wrapper.get('#review-directory-column-actions').attributes()).toHaveProperty('disabled')

    await wrapper.get('#review-directory-column-groups').setValue(true)
    expect(headerLabels(wrapper)).toStrictEqual([
      'Member',
      'Site registered',
      'Disclosed characters',
      'Groups',
      'Actions',
    ])
    await wrapper.get('button[aria-label="Move Groups earlier"]').trigger('click')
    expect(headerLabels(wrapper)).toStrictEqual([
      'Member',
      'Site registered',
      'Groups',
      'Disclosed characters',
      'Actions',
    ])

    const persisted = JSON.parse(
      localStorage.getItem(ORGANIZATION_REVIEW_DIRECTORY_COLUMN_PREFERENCE_STORAGE_KEY)!,
    )
    expect(persisted).toStrictEqual({
      fieldIds: ['member', 'site_registered_at', 'groups', 'disclosed_characters', 'actions'],
      version: 1,
    })

    await buttonWithText(wrapper, 'RESET TO DEFAULT').trigger('click')
    expect(headerLabels(wrapper)).toStrictEqual([
      'Member',
      'Corporation',
      'Managed since',
      'Audit data',
      'Groups',
      'Access status',
      'Actions',
    ])
  })

  it('emits normalized server controls, sorting, paging, and explicit member selection', async () => {
    const member = directoryMember()
    const wrapper = await mountDirectory({
      direction: 'asc',
      hasNextPage: true,
      hasPreviousPage: true,
      members: [member],
      page: 2,
      sort: 'member',
    })

    await wrapper.get('button[aria-label="Sort by Member, currently ascending"]').trigger('click')
    await wrapper.get('button[aria-label="Sort by Managed since"]').trigger('click')
    expect(wrapper.emitted('change-sort')).toStrictEqual([
      [{ direction: 'desc', sort: 'member' }],
      [{ direction: 'asc', sort: 'managed_since' }],
    ])

    await wrapper.get('input[placeholder="Character or account"]').setValue('Pilot')
    await wrapper.get('input[placeholder="All corporations"]').setValue('98000002')
    await wrapper.get('select[aria-label="Group filter"]').setValue('Remote reviewers')
    await wrapper.get('select[aria-label="Compliance filter"]').setValue('review_required')
    await wrapper.get('select[aria-label="Block state filter"]').setValue('blocked')
    await wrapper.get('select[aria-label="Audit data filter"]').setValue('stale')
    await wrapper.get('select[aria-label="Results per page"]').setValue('50')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('update:searchText')?.at(-1)).toStrictEqual(['Pilot'])
    expect(wrapper.emitted('update:corporationText')?.at(-1)).toStrictEqual(['98000002'])
    expect(wrapper.emitted('update:groupId')?.at(-1)).toStrictEqual(['group-remote'])
    expect(wrapper.emitted('update:complianceState')?.at(-1)).toStrictEqual(['review_required'])
    expect(wrapper.emitted('update:blocked')?.at(-1)).toStrictEqual([true])
    expect(wrapper.emitted('update:auditState')?.at(-1)).toStrictEqual(['stale'])
    expect(wrapper.emitted('update:limit')?.at(-1)).toStrictEqual([50])
    expect(wrapper.emitted('search')).toHaveLength(1)

    await wrapper.get('button[aria-label="Previous member page"]').trigger('click')
    await wrapper.get('button[aria-label="Next member page"]').trigger('click')
    await wrapper.get('button[aria-label="Select Review Pilot"]').trigger('click')
    await wrapper
      .get('button.ui-action-secondary.organization-review-directory__review')
      .trigger('click')

    expect(wrapper.emitted('previous')).toHaveLength(1)
    expect(wrapper.emitted('next')).toHaveLength(1)
    expect(wrapper.emitted('select')).toStrictEqual([[member], [member]])
    expect(wrapper.text()).toContain('Page 2')
    expect(wrapper.text()).not.toContain('Page 2 of')
  })

  it('preserves truthful null states and non-color-only blocked and partial summaries', async () => {
    const wrapper = await mountDirectory({
      members: [
        directoryMember({
          auditData: { asOf: null, covered: 3, expected: 7, state: 'authorization-required' },
          block: { blocked: true, blockedAt: '2026-09-17T00:00:00.000Z' },
          compliance: {
            accessValidUntil: null,
            evaluatedAt: null,
            evidenceAt: null,
            evidenceFreshness: 'stale',
            reviewDeadline: null,
            state: 'review_required',
          },
        }),
      ],
    })

    expect(wrapper.text()).toContain('Authorization required')
    expect(wrapper.text()).toContain('3 of 7 covered')
    expect(wrapper.text()).toContain('Access blocked')
    expect(wrapper.text()).toContain('Evidence stale')
    expect(wrapper.find('time[datetime=""]').exists()).toBe(false)
  })
})

async function mountDirectory(
  overrides: Partial<InstanceType<typeof OrganizationReviewDirectory>['$props']> = {},
) {
  const wrapper = await mountSuspended(OrganizationReviewDirectory, {
    global: {
      stubs: {
        UiAutocomplete: autocompleteStub,
        UiEveImage: eveImageStub,
        UiPopover: passThroughStub('UiPopover'),
        UiScrollArea: passThroughStub('UiScrollArea'),
        UiSelect: selectStub,
        UiTooltip: passThroughStub('UiTooltip'),
      },
    },
    props: {
      corporationText: '',
      groupFacets: [
        { groupId: 'group-alpha', name: 'Alpha' },
        { groupId: 'group-remote', name: 'Remote reviewers' },
      ],
      hasNextPage: false,
      hasPreviousPage: false,
      limit: 25,
      loading: false,
      members: [directoryMember()],
      searchText: '',
      ...overrides,
    },
  })
  mountedWrappers.push(wrapper)
  await nextTick()
  return wrapper
}

function headerLabels(wrapper: Awaited<ReturnType<typeof mountDirectory>>) {
  return wrapper.findAll('thead th').map((header) => {
    const sortLabel = header.find('button span')
    return sortLabel.exists() ? sortLabel.text() : header.text()
  })
}

function buttonWithText(wrapper: Awaited<ReturnType<typeof mountDirectory>>, text: string) {
  return wrapper.findAll('button').find((button) => button.text() === text)!
}

const eveImageStub = defineComponent({
  name: 'UiEveImage',
  props: { id: { required: true, type: Number } },
  setup(props) {
    return () => h('img', { alt: '', 'data-eve-id': props.id })
  },
})

const autocompleteStub = defineComponent({
  emits: ['update:modelValue'],
  name: 'UiAutocomplete',
  props: {
    label: { required: true, type: String },
    modelValue: { required: true, type: String },
    options: { required: true, type: Array as PropType<readonly string[]> },
  },
  setup(props, { emit }) {
    return () =>
      h(
        'select',
        {
          'aria-label': props.label,
          value: props.modelValue,
          onChange: (event: Event) =>
            emit('update:modelValue', (event.target as HTMLSelectElement).value),
        },
        [h('option', { value: '' }, 'All groups')].concat(
          props.options.map((option) => h('option', { value: option }, option)),
        ),
      )
  },
})

const selectStub = defineComponent({
  emits: ['update:modelValue'],
  name: 'UiSelect',
  props: {
    label: { required: true, type: String },
    modelValue: { required: true, type: String },
    options: {
      required: true,
      type: Array as PropType<readonly { label: string; value: string }[]>,
    },
  },
  setup(props, { emit }) {
    return () =>
      h(
        'select',
        {
          'aria-label': props.label,
          value: props.modelValue,
          onChange: (event: Event) =>
            emit('update:modelValue', (event.target as HTMLSelectElement).value),
        },
        props.options.map((option) => h('option', { value: option.value }, option.label)),
      )
  },
})

function passThroughStub(name: string) {
  return defineComponent({
    name,
    setup(_props, { slots }) {
      return () => h('div', [slots.trigger?.(), slots.default?.()])
    },
  })
}

function directoryMember(
  overrides: Partial<OrganizationReviewDirectoryMember> & { secondary?: boolean } = {},
): OrganizationReviewDirectoryMember {
  const secondary = overrides.secondary ?? false
  const characterId = secondary ? 90_000_002 : 90_000_001
  const base = {
    account: {
      mainCharacter: { characterId, name: secondary ? 'Remote Pilot' : 'Review Pilot' },
      userId: secondary
        ? 'ee800380-dc86-4c4f-9f26-0e6031848dbf'
        : '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
    },
    auditData: {
      asOf: '2026-09-18T00:00:00.000Z',
      covered: 7,
      expected: 7,
      state: 'current' as const,
    },
    block: { blocked: false as const },
    compliance: {
      accessValidUntil: '2026-09-19T00:00:00.000Z',
      evaluatedAt: '2026-09-18T00:00:00.000Z',
      evidenceAt: '2026-09-18T00:00:00.000Z',
      evidenceFreshness: 'fresh' as const,
      reviewDeadline: null,
      state: 'compliant' as const,
    },
    disclosedCharacterCount: secondary ? 2 : 1,
    groups: [
      { groupId: 'group-alpha', name: 'Alpha' },
      { groupId: 'group-bravo', name: 'Bravo' },
      { groupId: 'group-charlie', name: 'Charlie' },
      { groupId: 'group-delta', name: 'Delta' },
    ],
    managedAffiliation: {
      allianceId: null,
      characterId,
      checkedAt: '2026-09-18T00:00:00.000Z',
      corporationId: secondary ? 98_000_002 : 98_000_001,
      name: secondary ? 'Remote Pilot' : 'Review Pilot',
    },
    managedMemberLifecycleId: secondary ? 'member-lifecycle-2' : 'member-lifecycle-1',
    managedSince: secondary ? '2026-02-01T00:00:00.000Z' : '2026-01-01T00:00:00.000Z',
    portraitCharacter: {
      characterId,
      name: secondary ? 'Remote Pilot' : 'Review Pilot',
      source: 'main-character' as const,
    },
    siteRegisteredAt: '2025-12-01T00:00:00.000Z',
  }
  const { secondary: _secondary, ...memberOverrides } = overrides
  return { ...base, ...memberOverrides }
}
