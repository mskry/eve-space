<script setup lang="ts">
import {
  readPlatformApiResponse,
  type EsiQueryPersistencePresentation,
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
  esiPersistence: { kind: 'none' },
  moduleId: 'alpha',
  query: async ({ signal }) =>
    readPlatformApiResponse(
      await api.api.alpha[':characterId'].$get(
        { param: { characterId: String(route.params.characterId) } },
        { init: { signal } },
      ),
      'Alpha record is unavailable.',
    ),
  resource: ['record'],
  routeId: 'alpha-record',
  subject: { characterId: Number(route.params.characterId), kind: 'character' },
}))
const persistedSummaryQuery = usePlatformProtectedQuery(() => ({
  access: {
    authenticated: true,
    authorized: true,
    moduleEnabled: enabledModuleIds.value.has('alpha'),
  },
  esiPersistence: { kind: 'organization-esi' },
  moduleId: 'alpha',
  query: async () => ({ available: true }),
  resource: ['summary'],
  routeId: 'alpha-summary',
  subject: { kind: 'organization', organizationVersion: 1 },
}))
const resourceState = computed<PlatformResourceState>(() => {
  if (route.query.state === 'authorization') {
    return {
      action: { href: '/authorize-alpha', label: 'Authorize alpha' },
      message: 'Grant access to load this record.',
      status: 'authorization-required',
      title: 'Alpha authorization required',
    }
  }
  if (route.query.state === 'stale') {
    return {
      message: 'Showing the last available record.',
      retryLabel: 'Refresh alpha',
      status: 'stale',
      title: 'Alpha record is stale',
    }
  }
  if (resourceQuery.status.value === 'pending') {
    return { status: 'loading', title: 'Loading alpha record' }
  }
  if (resourceQuery.error.value) {
    return {
      message: resourceQuery.error.value.message,
      retryLabel: 'Retry',
      status: 'unavailable',
      title: 'Alpha record unavailable',
    }
  }
  return { status: 'ready' }
})
const persistencePresentation = computed<EsiQueryPersistencePresentation>(() => {
  if (route.query.presentation === 'restored') {
    return { kind: 'restored', originalSuccessAt: '2026-09-15T01:00:00.000Z' }
  }
  if (route.query.presentation === 'refresh-failed') {
    return {
      kind: 'restored-refresh-failed',
      originalSuccessAt: '2026-09-15T01:00:00.000Z',
      refreshFailureStatus: 503,
      retryAt: '2026-09-15T01:05:00.000Z',
    }
  }
  if (route.query.presentation === 'server-stale') {
    return {
      kind: 'server-stale',
      refreshFailureClass: 'esi-cooldown',
      validatedAt: '2026-09-15T01:02:00.000Z',
    }
  }
  return persistedSummaryQuery.persistencePresentation.value
})
const { openConfirmDialog } = usePlatformConfirmDialog()
const { announceSuccess } = usePlatformMutationAnnouncement()

function confirmRecord() {
  openConfirmDialog({
    description: 'Confirm the loaded alpha record.',
    onConfirm: () => announceSuccess('Alpha record confirmed.'),
    title: 'Confirm alpha record',
  })
}
</script>

<template>
  <section data-testid="alpha-page">
    <PlatformResourceBoundary
      :has-data="route.query.retained === 'true'"
      :presentation="persistencePresentation"
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
