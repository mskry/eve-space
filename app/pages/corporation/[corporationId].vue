<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import type { RecordSectionNavigationEntry } from '../../types/record-navigation'
import { corporationQuery } from '../../queries/corporations'
import { composeRecordPageTitle } from '../../utils/page-title'
import { ApiQueryError } from '../../utils/query-error'
import { parseRouteId } from '../../utils/route-id'

definePageMeta({ title: 'Corporation', layout: 'headerless' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { authLoading, authSession } = useAuthSession(apiClient)
const corporationId = computed(() => parseRouteId(route.params.corporationId))
const recordAccessAllowed = computed(() => !authLoading.value && authSession.value.authenticated)
const detailQuery = useQuery(() => ({
  ...corporationQuery({ apiClient, corporationId: corporationId.value ?? 0 }),
  enabled: import.meta.client && recordAccessAllowed.value && corporationId.value !== undefined,
}))
const corporation = computed(() =>
  recordAccessAllowed.value ? detailQuery.data.value?.corporation : undefined,
)
const detailStatus = computed(() => {
  if (!corporationId.value) return 'not-found'
  if (authLoading.value) return 'loading'
  if (!recordAccessAllowed.value) return 'idle'
  if (detailQuery.data.value) return 'idle'
  if (detailQuery.error.value instanceof ApiQueryError && detailQuery.error.value.status === 404) {
    return 'not-found'
  }
  if (detailQuery.status.value === 'error') return 'error'
  if (detailQuery.asyncStatus.value === 'loading') return 'loading'
  return 'idle'
})
const detailMessage = computed(() =>
  detailQuery.error.value instanceof Error ? detailQuery.error.value.message : '',
)
const navigation = computed<readonly RecordSectionNavigationEntry[]>(() => {
  if (corporationId.value === undefined) return []
  const overviewPath = `/corporation/${corporationId.value}`
  const overview = { id: 'overview', label: 'OVERVIEW', to: overviewPath, exact: true }
  if (corporation.value?.type !== 'player_owned') return [overview]

  return [
    overview,
    {
      id: 'alliance-history',
      label: 'ALLIANCE HISTORY',
      to: `${overviewPath}/alliance-history`,
    },
  ]
})

provideCorporationRecord({ corporationId, corporation, recordAccessAllowed })

useHead({
  title: computed(() =>
    composeRecordPageTitle(
      corporation.value ? `${corporation.value.name} [${corporation.value.ticker}]` : undefined,
      route.meta.title,
      'Corporation',
    ),
  ),
})
</script>

<template>
  <div class="section-page character-shell">
    <UiStatePanel v-if="detailStatus === 'loading'" role="status">
      <template #icon><div class="app-scanner" aria-hidden="true" /></template>
      <p>Resolving corporation record...</p>
    </UiStatePanel>
    <UiStatePanel
      v-else-if="detailStatus === 'not-found'"
      code="404 / CORPORATION"
      title="Corporation not found"
      role="alert"
      tone="error"
    >
      <p>ESI has no public record for ID {{ corporationId ?? '—' }}.</p>
      <template #action>
        <button class="ui-action-secondary" type="button" @click="$router.back()">GO BACK</button>
      </template>
    </UiStatePanel>
    <UiStatePanel
      v-else-if="detailStatus === 'error'"
      code="ERR / ESI"
      title="Record unavailable"
      role="alert"
      tone="error"
    >
      <p>{{ detailMessage }}</p>
      <template #action>
        <button class="ui-action-secondary" type="button" @click="detailQuery.refresh()">
          RETRY
        </button>
      </template>
    </UiStatePanel>

    <template v-else-if="corporation">
      <header class="character-shell-header">
        <button class="character-shell-back" type="button" @click="$router.back()">← BACK</button>
        <div class="character-shell-identity">
          <span class="character-shell-portrait">
            <UiEveImage
              kind="corporation"
              :id="corporation.corporationId"
              :dimension="72"
              :width="72"
              :height="72"
              loading="eager"
              decoding="async"
              :alt="`${corporation.name} corporation logo`"
            />
          </span>
          <div>
            <p class="ui-eyebrow">CORPORATION / {{ corporation.ticker }}</p>
            <h1>{{ corporation.name }}</h1>
            <div v-if="corporation.allianceId" class="character-shell-meta">
              <span class="character-shell-affiliation">
                <UiEveImage
                  kind="alliance"
                  :id="corporation.allianceId"
                  :dimension="32"
                  :width="32"
                  :height="32"
                  loading="lazy"
                  decoding="async"
                  :alt="`${corporation.allianceName ?? `Alliance ${corporation.allianceId}`} logo`"
                />
                <span>
                  <small>ALLIANCE</small>
                  <strong>{{ corporation.allianceName ?? `ID ${corporation.allianceId}` }}</strong>
                </span>
              </span>
            </div>
          </div>
        </div>
      </header>

      <RecordSectionNavigation :entries="navigation" label="Corporation record sections" />
      <NuxtPage />
    </template>
  </div>
</template>

<style lang="css">
@import url('~/assets/css/features/character-record.css');
@import url('~/assets/css/responsive/record.css');
</style>
