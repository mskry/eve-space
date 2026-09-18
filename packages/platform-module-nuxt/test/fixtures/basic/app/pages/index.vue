<script setup lang="ts">
import type {
  PlatformReviewerPanelComponent,
  PlatformReviewerPanelProps,
} from '@eve-space/platform-module-nuxt/runtime'

const reviewerPanel = shallowRef<PlatformReviewerPanelComponent | null>(null)
const selectedPanel = ref({
  moduleId: 'alpha',
  contributionId: 'overview',
  routeId: 'alpha-summary',
})
const reviewerPanelProps = computed<PlatformReviewerPanelProps>(() => ({
  ...selectedPanel.value,
  organizationVersion: 7,
  target: {
    kind: 'managed-organization-account',
    managedMemberLifecycleId: 'member-lifecycle-1',
    userId: 'user-1',
  },
  queryAccess: {
    authenticated: true,
    authorized: true,
    moduleEnabled: true,
  },
}))

async function loadReviewerPanel(
  moduleId = 'alpha',
  contributionId = 'overview',
  routeId = 'alpha-summary',
) {
  selectedPanel.value = { moduleId, contributionId, routeId }
  reviewerPanel.value = (await usePlatformReviewerPanels().load(moduleId, contributionId)).default
}
</script>

<template>
  <main>
    <h1>Fixture home</h1>
    <button type="button" @click="loadReviewerPanel()">Load reviewer panel</button>
    <button type="button" @click="loadReviewerPanel('beta', 'details', 'beta-details')">
      Load beta reviewer panel
    </button>
    <component v-if="reviewerPanel" :is="reviewerPanel" v-bind="reviewerPanelProps" />
  </main>
</template>
