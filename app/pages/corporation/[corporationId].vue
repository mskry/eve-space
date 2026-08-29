<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import type { RecordSectionNavigationEntry } from '../../types/record-navigation'
import { corporationQuery } from '../../queries/corporations'
import { ApiQueryError } from '../../utils/query-error'
import { parseRouteId } from '../../utils/route-id'

definePageMeta({ title: 'Corporation', layout: 'headerless' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const corporationId = computed(() => parseRouteId(route.params.corporationId))
const detailQuery = useQuery(() => ({
  ...corporationQuery({ apiClient, corporationId: corporationId.value ?? 0 }),
  enabled: import.meta.client && corporationId.value !== undefined,
}))
const corporation = computed(() => detailQuery.data.value?.corporation)
const detailStatus = computed(() => {
  if (!corporationId.value) return 'not-found'
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
  return [
    { id: 'overview', label: 'OVERVIEW', to: overviewPath, exact: true },
    {
      id: 'alliance-history',
      label: 'ALLIANCE HISTORY',
      to: `${overviewPath}/alliance-history`,
    },
  ]
})

provideCorporationRecord({ corporationId, corporation })

useHead({
  title: computed(() =>
    corporation.value
      ? `${corporation.value.name} [${corporation.value.ticker}] // Corporations // EVE Space`
      : 'Corporation // EVE Space',
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
          <UiEveImage
            kind="corporation"
            :id="corporation.corporationId"
            :dimension="72"
            :alt="`${corporation.name} corporation logo`"
          />
          <div>
            <p class="ui-eyebrow">CORPORATION / {{ corporation.ticker }}</p>
            <h1>{{ corporation.name }}</h1>
            <p>
              {{ corporation.memberCount.toLocaleString('en-US') }} MEMBERS · Tax
              {{ corporation.taxRate !== null ? `${corporation.taxRate.toFixed(1)}%` : '—'
              }}<template v-if="corporation.allianceName">
                · {{ corporation.allianceName }}</template
              ><template v-else-if="corporation.allianceId">
                · Alliance {{ corporation.allianceId }}</template
              ><template v-if="corporation.factionId">
                · Faction {{ corporation.factionId }}</template
              ><template v-if="corporation.type !== 'player_owned'">
                ·
                {{ corporation.type === 'npc_owned' ? 'NPC' : corporation.type.toUpperCase() }}
              </template>
            </p>
          </div>
        </div>
      </header>

      <RecordSectionNavigation :entries="navigation" label="Corporation record sections" />
      <NuxtPage />
    </template>
  </div>
</template>

<style>
@import url('~/assets/css/features/character-record.css');
@import url('~/assets/css/responsive/record.css');
</style>
