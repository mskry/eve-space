import {
  organizationReviewDirectoryDefaultFieldIds,
  organizationReviewDirectoryPreferenceVersion,
} from '../../app/utils/organization-review-directory-fields'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createSSRApp, defineComponent, h, nextTick } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ORGANIZATION_REVIEW_DIRECTORY_COLUMN_PREFERENCE_STORAGE_KEY,
  useOrganizationReviewDirectoryColumnPreferences,
} from '../../app/composables/useOrganizationReviewDirectoryColumnPreferences'

const mountedWrappers: VueWrapper[] = []

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount()
  }
})

describe('organization review directory column preferences', () => {
  it('uses the same stable defaults for server and initial client rendering before restoring storage', async () => {
    const storage = preferenceStorage(
      JSON.stringify({
        fieldIds: ['site_registered_at'],
        version: organizationReviewDirectoryPreferenceVersion,
      }),
    )
    const getStorage = vi.fn(() => storage)
    const setupValues: string[][] = []
    const Root = defineComponent({
      setup() {
        const preferences = useOrganizationReviewDirectoryColumnPreferences(getStorage)
        setupValues.push([...preferences.visibleFieldIds.value])
        preferences.hideField('groups')
        preferences.moveField('corporation', 'down')
        preferences.resetFields()
        return () => h('output', preferences.visibleFieldIds.value.join(','))
      },
    })

    const serverHtml = await renderToString(createSSRApp(Root))

    expect(serverHtml).toContain(organizationReviewDirectoryDefaultFieldIds.join(','))
    expect(getStorage).not.toHaveBeenCalled()

    const wrapper = mount(Root)
    mountedWrappers.push(wrapper)
    await nextTick()

    expect(setupValues).toStrictEqual([
      [...organizationReviewDirectoryDefaultFieldIds],
      [...organizationReviewDirectoryDefaultFieldIds],
    ])
    expect(getStorage).toHaveBeenCalledOnce()
    expect(storage.getItem).toHaveBeenCalledWith(
      ORGANIZATION_REVIEW_DIRECTORY_COLUMN_PREFERENCE_STORAGE_KEY,
    )
    expect(wrapper.text()).toBe('member,site_registered_at,actions')
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('restores a valid ordered field preference', () => {
    const storage = preferenceStorage(
      JSON.stringify({
        fieldIds: ['blocked_since', 'groups', 'corporation'],
        version: organizationReviewDirectoryPreferenceVersion,
      }),
    )

    const { preferences } = mountPreferences(() => storage)

    expect(preferences.visibleFieldIds.value).toStrictEqual([
      'member',
      'blocked_since',
      'groups',
      'corporation',
      'actions',
    ])
  })

  it('hides and shows optional fields while persisting only versioned field IDs', () => {
    const storage = preferenceStorage(null)
    const { preferences } = mountPreferences(() => storage)

    preferences.hideField('groups')
    preferences.showField('site_registered_at')
    preferences.hideField('member')
    preferences.showField('actions')

    const expectedFieldIds = [
      'member',
      'corporation',
      'managed_since',
      'audit_data',
      'access_status',
      'site_registered_at',
      'actions',
    ]
    expect(preferences.visibleFieldIds.value).toStrictEqual(expectedFieldIds)
    expect(storage.setItem).toHaveBeenCalledTimes(2)
    const serialized = storage.setItem.mock.lastCall?.[1]
    expect(serialized).toBeDefined()
    expect(storage.setItem.mock.lastCall?.[0]).toBe(
      ORGANIZATION_REVIEW_DIRECTORY_COLUMN_PREFERENCE_STORAGE_KEY,
    )
    expect(JSON.parse(serialized!)).toStrictEqual({
      fieldIds: expectedFieldIds,
      version: organizationReviewDirectoryPreferenceVersion,
    })
  })

  it('moves optional fields in keyboard-control directions without moving locked edges', () => {
    const storage = preferenceStorage(null)
    const { preferences } = mountPreferences(() => storage)

    preferences.moveField('groups', 'up')
    expect(preferences.visibleFieldIds.value).toStrictEqual([
      'member',
      'corporation',
      'managed_since',
      'groups',
      'audit_data',
      'access_status',
      'actions',
    ])

    preferences.moveField('groups', 'down')
    preferences.moveField('corporation', 'up')
    preferences.moveField('access_status', 'down')
    preferences.moveField('member', 'down')
    preferences.moveField('actions', 'up')

    expect(preferences.visibleFieldIds.value).toStrictEqual(
      organizationReviewDirectoryDefaultFieldIds,
    )
    expect(storage.setItem).toHaveBeenCalledTimes(2)
  })

  it('repairs locked fields and discards unknown and duplicate saved IDs', () => {
    const storage = preferenceStorage(
      JSON.stringify({
        fieldIds: ['actions', 'groups', 'unknown', 'groups', 'member', 'site_registered_at'],
        version: organizationReviewDirectoryPreferenceVersion,
      }),
    )

    const { preferences } = mountPreferences(() => storage)

    expect(preferences.visibleFieldIds.value).toStrictEqual([
      'member',
      'groups',
      'site_registered_at',
      'actions',
    ])
  })

  it('resets a restored layout to the documented defaults and persists the reset', () => {
    const storage = preferenceStorage(
      JSON.stringify({
        fieldIds: ['blocked_since'],
        version: organizationReviewDirectoryPreferenceVersion,
      }),
    )
    const { preferences } = mountPreferences(() => storage)

    preferences.resetFields()

    expect(preferences.visibleFieldIds.value).toStrictEqual(
      organizationReviewDirectoryDefaultFieldIds,
    )
    expect(storage.setItem).toHaveBeenCalledOnce()
    expect(storage.setItem).toHaveBeenCalledWith(
      ORGANIZATION_REVIEW_DIRECTORY_COLUMN_PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        fieldIds: organizationReviewDirectoryDefaultFieldIds,
        version: organizationReviewDirectoryPreferenceVersion,
      }),
    )
  })

  it.each([
    ['missing storage value', null],
    ['corrupt JSON', '{not-json'],
    [
      'invalid preference shape',
      JSON.stringify({
        fieldIds: 'groups',
        version: organizationReviewDirectoryPreferenceVersion,
      }),
    ],
    ['an old preference version', JSON.stringify({ fieldIds: ['groups'], version: 0 })],
  ])('falls back to defaults for %s', (_name, storedValue) => {
    const storage = preferenceStorage(storedValue)

    const { preferences } = mountPreferences(() => storage)

    expect(preferences.visibleFieldIds.value).toStrictEqual(
      organizationReviewDirectoryDefaultFieldIds,
    )
  })

  it('keeps defaults when storage is unavailable or throws while reading', () => {
    const unavailable = mountPreferences(() => undefined)
    const throwingStorage = preferenceStorage(null)
    throwingStorage.getItem.mockImplementation(() => {
      throw new Error('Storage blocked')
    })
    const throwing = mountPreferences(() => throwingStorage)

    expect(unavailable.preferences.visibleFieldIds.value).toStrictEqual(
      organizationReviewDirectoryDefaultFieldIds,
    )
    expect(throwing.preferences.visibleFieldIds.value).toStrictEqual(
      organizationReviewDirectoryDefaultFieldIds,
    )
  })

  it('keeps preference controls usable when storage writes throw', () => {
    const storage = preferenceStorage(null)
    storage.setItem.mockImplementation(() => {
      throw new Error('Storage blocked')
    })
    const { preferences } = mountPreferences(() => storage)

    expect(() => preferences.hideField('groups')).not.toThrow()
    expect(() => preferences.showField('site_registered_at')).not.toThrow()
    expect(() => preferences.moveField('site_registered_at', 'up')).not.toThrow()
    expect(() => preferences.resetFields()).not.toThrow()
    expect(preferences.visibleFieldIds.value).toStrictEqual(
      organizationReviewDirectoryDefaultFieldIds,
    )
  })
})

function mountPreferences(getStorage: () => ReturnType<typeof preferenceStorage> | undefined) {
  let preferences!: ReturnType<typeof useOrganizationReviewDirectoryColumnPreferences>
  const Root = defineComponent({
    setup() {
      preferences = useOrganizationReviewDirectoryColumnPreferences(getStorage)
      return () => h('output', preferences.visibleFieldIds.value.join(','))
    },
  })
  const wrapper = mount(Root)
  mountedWrappers.push(wrapper)
  return { preferences, wrapper }
}

function preferenceStorage(storedValue: string | null) {
  let value = storedValue
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, nextValue: string) => {
      value = nextValue
    }),
  }
}
