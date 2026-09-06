<script setup lang="ts">
import { computed } from 'vue'
import {
  ApiQueryError,
  readPlatformApiResponse,
  type PlatformResourceState,
} from '@eve-space/platform-module-nuxt/runtime'

useHead({ title: 'Conformance Activity' })

const route = useRoute()
const api = usePlatformApi()
const { enabledModuleIds } = usePlatformModuleRuntime()
const characterId = computed(() => Number(route.params.characterId))
const activityQuery = usePlatformProtectedQuery(() => ({
  access: {
    authenticated: true,
    moduleEnabled: enabledModuleIds.value.has('conformance'),
    ownsCharacter: true,
  },
  moduleId: 'conformance',
  resource: ['activity'],
  subject: { kind: 'character', characterId: characterId.value },
  query: async ({ signal }) =>
    readPlatformApiResponse(
      await api.api.modules.conformance.characters[':characterId'].$get(
        {
          param: { characterId: String(characterId.value) },
          query: { view: 'summary' },
        },
        { init: { signal } },
      ),
      'Conformance activity is unavailable.',
    ),
}))
const resourceState = computed<PlatformResourceState>(() => {
  const resource = activityQuery.data.value?.resource
  if (resource?.status === 'stale')
    return {
      status: 'stale',
      title: 'Conformance activity is stale',
      message: 'Showing the last production-shaped fixture snapshot.',
      retryLabel: 'Refresh activity',
    }
  if (activityQuery.status.value === 'pending')
    return { status: 'loading', title: 'Loading conformance activity' }

  const error = activityQuery.error.value
  if (error instanceof ApiQueryError && (error.status === 401 || error.status === 403))
    return {
      status: 'authorization-required',
      title: 'Conformance authorization required',
      message: error.message,
      retryLabel: 'Retry authorization',
    }
  if (error)
    return {
      status: 'unavailable',
      title: 'Conformance activity unavailable',
      message: error.message,
      retryLabel: 'Retry activity',
    }
  return { status: 'ready' }
})
const { openConfirmDialog } = usePlatformConfirmDialog()
const { announceSuccess } = usePlatformMutationAnnouncement()

function confirmActivity() {
  openConfirmDialog({
    title: 'Confirm conformance activity',
    description: 'Confirm the shared interaction surface is active.',
    onConfirm: () => announceSuccess('Conformance activity confirmed.'),
  })
}
</script>

<template>
  <main id="main-content" class="conformance-activity-page" tabindex="-1">
    <h1>Conformance Activity</h1>
    <PlatformResourceBoundary
      :has-data="Boolean(activityQuery.data.value)"
      :state="resourceState"
      @retry="activityQuery.refresh()"
    >
      <p>
        Character {{ activityQuery.data.value?.characterId }} belongs to corporation
        {{ activityQuery.data.value?.corporationId }}.
      </p>
    </PlatformResourceBoundary>
    <button type="button" @click="confirmActivity">Confirm activity</button>
  </main>
</template>

<style scoped>
.conformance-activity-page {
  max-width: 48rem;
  margin: 0 auto;
  padding: 2rem 1rem;
}
</style>
