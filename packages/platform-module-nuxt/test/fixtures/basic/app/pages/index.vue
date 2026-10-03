<script setup lang="ts">
import type {
  GraphQLDocument,
  PlatformReviewerPanelComponent,
  PlatformReviewerPanelProps,
} from '@eve-space/platform-module-nuxt/runtime'

const publicDocument: GraphQLDocument<{ publicValue: string }, { id: string }> = {
  toString: () => 'query PublicValue($id: ID!) { publicValue(id: $id) }',
}
const executeGraphQL = usePlatformGraphQL()
const publicValue = ref('')
const loadPublicValue = async () => {
  const result = await executeGraphQL(publicDocument, { id: '7' })
  publicValue.value = result.data?.publicValue ?? ''
}

const reviewerPanel = shallowRef<PlatformReviewerPanelComponent | null>(null)
const selectedPanel = ref({
  contributionId: 'overview',
  moduleId: 'alpha',
  routeId: 'alpha-summary',
})
const reviewerPanelProps = computed<PlatformReviewerPanelProps>(() => ({
  ...selectedPanel.value,
  organizationVersion: 7,
  queryAccess: {
    authenticated: true,
    authorized: true,
    moduleEnabled: true,
  },
  target: {
    kind: 'managed-organization-account',
    managedMemberLifecycleId: 'member-lifecycle-1',
    userId: 'user-1',
  },
}))

async function loadReviewerPanel(
  moduleId = 'alpha',
  contributionId = 'overview',
  routeId = 'alpha-summary',
) {
  selectedPanel.value = { contributionId, moduleId, routeId }
  reviewerPanel.value = (await usePlatformReviewerPanels().load(moduleId, contributionId)).default
}
</script>

<template>
  <main>
    <h1>Fixture home</h1>
    <button type="button" @click="loadPublicValue">Load public value</button>
    <output>{{ publicValue }}</output>
    <button type="button" @click="loadReviewerPanel()">Load reviewer panel</button>
    <button type="button" @click="loadReviewerPanel('beta', 'details', 'beta-details')">
      Load beta reviewer panel
    </button>
    <component v-if="reviewerPanel" :is="reviewerPanel" v-bind="reviewerPanelProps" />
  </main>
</template>
