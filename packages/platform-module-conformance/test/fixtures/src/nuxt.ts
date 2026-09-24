import { defineNuxtModule } from '@nuxt/kit'
import type { PlatformReviewerNuxtContribution } from '@eve-space/platform-module-contract/nuxt'
import type { PlatformReviewerPanelModule } from '@eve-space/platform-module-nuxt/runtime/reviewer-panel'

export const fixturePanel = {
  audience: 'hr',
  contributionId: 'fixture-review',
  description: 'Isolated public-contract fixture',
  icon: 'overview',
  label: 'Fixture review',
  order: 10,
  panelExport: './runtime/FixtureReviewPanel.vue',
  requiredPermission: 'fixture.review',
  routeId: 'fixture-review-route',
  routePath: '/api/modules/fixture/review/:userId',
  target: 'managed-organization-account',
} satisfies PlatformReviewerNuxtContribution

export const fixturePanelModule = {
  default: () => null,
} satisfies PlatformReviewerPanelModule

export default defineNuxtModule({
  meta: { name: '@example/fixture-nuxt' },
})
