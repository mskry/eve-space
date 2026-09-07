<script setup lang="ts">
import {
  readPlatformApiResponse,
  type PlatformResourceState,
} from '@eve-space/platform-module-nuxt/runtime'

const route = useRoute()
const api = usePlatformApi()
const { enabledModuleIds } = usePlatformModuleRuntime()
const page = ref(1)
const resourceQuery = usePlatformProtectedQuery(() => ({
  access: {
    authenticated: true,
    moduleEnabled: enabledModuleIds.value.has('alpha'),
    ownsCharacter: true,
  },
  moduleId: 'alpha',
  resource: ['record'],
  subject: { kind: 'character', characterId: Number(route.params.characterId) },
  query: async ({ signal }) =>
    readPlatformApiResponse(
      await api.api.alpha[':characterId'].$get(
        { param: { characterId: String(route.params.characterId) } },
        { init: { signal } },
      ),
      'Alpha record is unavailable.',
    ),
}))
const resourceState = computed<PlatformResourceState>(() => {
  if (route.query.state === 'authorization')
    return {
      status: 'authorization-required',
      title: 'Alpha authorization required',
      message: 'Grant access to load this record.',
      action: { href: '/authorize-alpha', label: 'Authorize alpha' },
    }
  if (route.query.state === 'stale')
    return {
      status: 'stale',
      title: 'Alpha record is stale',
      message: 'Showing the last available record.',
      retryLabel: 'Refresh alpha',
    }
  if (resourceQuery.status.value === 'pending')
    return { status: 'loading', title: 'Loading alpha record' }
  if (resourceQuery.error.value)
    return {
      status: 'unavailable',
      title: 'Alpha record unavailable',
      message: resourceQuery.error.value.message,
      retryLabel: 'Retry',
    }
  return { status: 'ready' }
})
const { openConfirmDialog } = usePlatformConfirmDialog()
const { announceSuccess } = usePlatformMutationAnnouncement()

function confirmRecord() {
  openConfirmDialog({
    title: 'Confirm alpha record',
    description: 'Confirm the loaded alpha record.',
    onConfirm: () => announceSuccess('Alpha record confirmed.'),
  })
}
</script>

<template>
  <section data-testid="alpha-page">
    <PlatformResourceBoundary
      :has-data="route.query.retained === 'true'"
      :state="resourceState"
      @retry="resourceQuery.refresh()"
    >
      <p>{{ resourceQuery.data.value?.name ?? 'Alpha nested page' }}</p>
    </PlatformResourceBoundary>
    <PlatformEveImage alt="Alpha character" :dimension="32" :id="7" kind="character" />
    <PlatformPagination
      :current-page="page"
      label="Alpha pages"
      :total-pages="2"
      @change-page="page = $event"
    />
    <button type="button" @click="confirmRecord">Confirm record</button>
  </section>
</template>
