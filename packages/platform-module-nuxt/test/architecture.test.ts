import { describe, expect, it } from 'vitest'
import { platformNuxtBoundaryViolations } from '../../../scripts/platform-nuxt-boundaries.js'

describe('platform Nuxt dependency direction', () => {
  it('allows build adapters and runtime consumers to share navigation types', () => {
    expect(
      platformNuxtBoundaryViolations([
        {
          path: 'navigation.ts',
          source: "import type { PlatformNavigationEntry } from './runtime/navigation.js'",
        },
        {
          path: 'runtime/app/composables/useNavigation.ts',
          source: "import type { PlatformNavigationEntry } from '../../navigation.js'",
        },
      ]),
    ).toEqual([])
  })

  it.each([
    ['runtime/app/composables/useNavigation.ts', '@nuxt/kit'],
    ['runtime/app/composables/useNavigation.ts', '../../../module.js'],
    ['runtime/app/composables/useNavigation.ts', 'node:fs'],
    ['navigation.ts', './templates.js'],
    ['navigation.ts', './runtime/app/composables/usePlatformNavigation.js'],
    ['templates.ts', './module.js'],
  ])('rejects %s importing %s', (path, specifier) => {
    expect(
      platformNuxtBoundaryViolations([{ path, source: `import { value } from '${specifier}'` }]),
    ).not.toEqual([])
  })

  it('checks imports in Vue scripts', () => {
    expect(
      platformNuxtBoundaryViolations([
        {
          path: 'runtime/app/components/FeatureCard.vue',
          source: '<script setup>import { addImports } from "@nuxt/kit"</script>',
        },
      ]),
    ).not.toEqual([])
  })

  it('requires new build modules to declare their architectural tier', () => {
    expect(
      platformNuxtBoundaryViolations([{ path: 'new-adapter.ts', source: 'export {}' }]),
    ).toEqual(['new-adapter.ts: build module has no declared tier'])
  })
})
