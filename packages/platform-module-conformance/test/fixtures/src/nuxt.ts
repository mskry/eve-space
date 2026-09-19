import { defineNuxtModule } from '@nuxt/kit'
import type { PlatformReviewerNuxtContribution } from '@eve-space/platform-module-contract/nuxt'
import type { PlatformReviewerPanelModule } from '@eve-space/platform-module-nuxt/runtime/reviewer-panel'

export const fixturePanel = {
  contributionId: 'fixture-review',
  routeId: 'fixture-review-route',
  routePath: '/api/modules/fixture/review/:userId',
  audience: 'hr',
  requiredPermission: 'fixture.review',
  target: 'managed-organization-account',
  panelExport: './runtime/FixtureReviewPanel.vue',
  label: 'Fixture review',
  description: 'Isolated public-contract fixture',
  icon: 'overview',
  order: 10,
} satisfies PlatformReviewerNuxtContribution

export const fixturePanelModule = {
  default: () => null,
} satisfies PlatformReviewerPanelModule

export default defineNuxtModule({
  meta: { name: '@example/fixture-nuxt' },
})
