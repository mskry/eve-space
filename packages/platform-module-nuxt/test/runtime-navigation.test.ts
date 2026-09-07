import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { usePlatformNavigation } from '../src/runtime/app/composables/usePlatformNavigation.js'

const enabledModuleIds = ref(new Set<string>())
const data = ref<{
  shellNavigationOrder: { dashboard: { ownerId: string; navigationId: string }[] }
}>()
vi.mock('#imports', async () => ({ computed: (await import('vue')).computed }))
vi.mock('../src/runtime/app/composables/usePlatformModuleRuntime.js', () => ({
  usePlatformModuleRuntime: () => ({ enabledModuleIds, runtimeQuery: { data } }),
}))
vi.mock('#build/eve-space-platform/navigation', () => ({
  platformNavigation: [
    { ownerId: 'core', navigationId: 'home', placement: 'dashboard' },
    { ownerId: 'alpha', navigationId: 'feed', placement: 'dashboard' },
    { ownerId: 'core', navigationId: 'settings', placement: 'dashboard' },
    { ownerId: 'beta', navigationId: 'feed', placement: 'dashboard' },
    { ownerId: 'alpha', navigationId: 'character', placement: 'character' },
  ],
}))

describe('runtime navigation', () => {
  it('filters by placement and enabled modules while retaining core entries', () => {
    data.value = undefined
    enabledModuleIds.value = new Set()
    const { navigation } = usePlatformNavigation('dashboard')
    expect(navigation.value.map((entry) => entry.navigationId)).toEqual(['home', 'settings'])
    enabledModuleIds.value = new Set(['alpha'])
    expect(navigation.value.map((entry) => entry.navigationId)).toEqual([
      'home',
      'feed',
      'settings',
    ])
    expect(
      usePlatformNavigation('character').navigation.value.map((entry) => entry.navigationId),
    ).toEqual(['character'])
  })
  it('uses owner-qualified server order and inserts missing entries beside their predecessors', () => {
    enabledModuleIds.value = new Set(['alpha', 'beta'])
    data.value = {
      shellNavigationOrder: {
        dashboard: [
          { ownerId: 'beta', navigationId: 'feed' },
          { ownerId: 'missing', navigationId: 'feed' },
          { ownerId: 'alpha', navigationId: 'feed' },
        ],
      },
    }
    const { navigation } = usePlatformNavigation('dashboard')
    expect(navigation.value.map((entry) => `${entry.ownerId}/${entry.navigationId}`)).toEqual([
      'core/home',
      'beta/feed',
      'alpha/feed',
      'core/settings',
    ])
    enabledModuleIds.value = new Set()
    expect(navigation.value.map((entry) => entry.navigationId)).toEqual(['home', 'settings'])
  })
})
