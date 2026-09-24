import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { usePlatformNavigation } from '../src/runtime/app/composables/usePlatformNavigation.js'

const enabledModuleIds = ref(new Set<string>())
const enabledSectionKeys = ref(new Set<string>())
const data = ref<{
  shellNavigationOrder: { dashboard: { ownerId: string; navigationId: string }[] }
}>()
vi.mock('#imports', async () => ({ computed: (await import('vue')).computed }))
vi.mock('../src/runtime/app/composables/usePlatformModuleRuntime.js', () => ({
  usePlatformModuleRuntime: () => ({
    enabledModuleIds,
    enabledSectionKeys,
    runtimeQuery: { data },
  }),
}))
vi.mock('#build/eve-space-platform/navigation', () => ({
  platformNavigation: [
    { navigationId: 'home', ownerId: 'core', placement: 'dashboard' },
    { navigationId: 'feed', ownerId: 'alpha', placement: 'dashboard' },
    { navigationId: 'skills', ownerId: 'alpha', placement: 'dashboard', sectionId: 'skills' },
    { navigationId: 'assets', ownerId: 'alpha', placement: 'dashboard', sectionId: 'assets' },
    { navigationId: 'settings', ownerId: 'core', placement: 'dashboard' },
    { navigationId: 'feed', ownerId: 'beta', placement: 'dashboard' },
    { navigationId: 'character', ownerId: 'alpha', placement: 'character' },
  ],
}))

describe('runtime navigation', () => {
  it('filters by placement and enabled modules while retaining core entries', () => {
    data.value = undefined
    enabledModuleIds.value = new Set()
    const { navigation } = usePlatformNavigation('dashboard')
    expect(navigation.value.map((entry) => entry.navigationId)).toStrictEqual(['home', 'settings'])
    enabledModuleIds.value = new Set(['alpha'])
    expect(navigation.value.map((entry) => entry.navigationId)).toStrictEqual([
      'home',
      'feed',
      'settings',
    ])
    enabledSectionKeys.value = new Set(['alpha/skills'])
    expect(navigation.value.map((entry) => entry.navigationId)).toStrictEqual([
      'home',
      'feed',
      'skills',
      'settings',
    ])
    expect(
      usePlatformNavigation('character').navigation.value.map((entry) => entry.navigationId),
    ).toStrictEqual(['character'])
  })
  it('uses owner-qualified server order and inserts missing entries beside their predecessors', () => {
    enabledModuleIds.value = new Set(['alpha', 'beta'])
    enabledSectionKeys.value = new Set(['alpha/skills', 'alpha/assets'])
    data.value = {
      shellNavigationOrder: {
        dashboard: [
          { navigationId: 'feed', ownerId: 'beta' },
          { navigationId: 'feed', ownerId: 'missing' },
          { navigationId: 'feed', ownerId: 'alpha' },
        ],
      },
    }
    const { navigation } = usePlatformNavigation('dashboard')
    expect(navigation.value.map((entry) => `${entry.ownerId}/${entry.navigationId}`)).toStrictEqual(
      ['core/home', 'beta/feed', 'alpha/feed', 'alpha/skills', 'alpha/assets', 'core/settings'],
    )
    enabledModuleIds.value = new Set()
    expect(navigation.value.map((entry) => entry.navigationId)).toStrictEqual(['home', 'settings'])
  })
})
