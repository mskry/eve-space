import type { PlatformNuxtContributionDescriptor } from '@eve-space/platform-module-contract'
import { describe, expect, it } from 'vitest'
import { validateResolvedExposures } from '../src/resolved-exposures.js'

const contribution: PlatformNuxtContributionDescriptor = {
  moduleId: 'alpha',
  defaultIcon: 'character',
  pages: [],
  navigation: [],
  exposed: {
    components: ['EveAlphaCard'],
    composables: ['useEveAlphaData'],
  },
}
const roots = new Map([['alpha', '/workspace/features/alpha/nuxt']])

describe('resolved Nuxt exposure validation', () => {
  it('accepts one registration from the declaring feature package', () => {
    expect(() =>
      validateResolvedExposures(
        [contribution],
        roots,
        [{ name: 'EveAlphaCard', from: '/workspace/features/alpha/nuxt/src/card.vue' }],
        'components',
      ),
    ).not.toThrow()
  })

  it('rejects a core registration with the same resolved name', () => {
    expect(() =>
      validateResolvedExposures(
        [contribution],
        roots,
        [
          { name: 'EveAlphaCard', from: '/workspace/features/alpha/nuxt/src/card.vue' },
          { name: 'EveAlphaCard', from: '/workspace/app/components/EveAlphaCard.vue' },
        ],
        'components',
      ),
    ).toThrow('Nuxt component EveAlphaCard from alpha must resolve exactly once')
  })

  it('rejects a declaration resolved from the wrong package', () => {
    expect(() =>
      validateResolvedExposures(
        [contribution],
        roots,
        [{ name: 'useEveAlphaData', from: '/workspace/app/composables/useEveAlphaData.ts' }],
        'composables',
      ),
    ).toThrow('Nuxt composable useEveAlphaData from alpha must resolve exactly once')
  })
})
