<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import { corporationAllianceHistoryQuery } from '../../../queries/corporations'
import { buildHistoryTimeline } from '../../../utils/history-timeline'

definePageMeta({ title: 'Corporation Alliance History', layout: 'headerless' })

const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { corporationId } = useCorporationRecord()
const historyQuery = useQuery(() => ({
  ...corporationAllianceHistoryQuery({ apiClient, corporationId: corporationId.value ?? 0 }),
  enabled: import.meta.client && corporationId.value !== undefined,
}))
const historyStatus = computed(() => {
  if (historyQuery.data.value) return 'idle'
  if (historyQuery.status.value === 'error') return 'error'
  if (historyQuery.asyncStatus.value === 'loading') return 'loading'
  return 'idle'
})
const historyMessage = computed(() =>
  historyQuery.error.value instanceof Error
    ? historyQuery.error.value.message
    : 'Alliance history is unavailable.',
)
const searchableHistory = computed(() =>
  buildHistoryTimeline(historyQuery.data.value?.history ?? []).map((entry) => ({
    recordId: entry.recordId,
    startDate: entry.startDate,
    endDate: entry.endDate,
    isDeleted: entry.isDeleted,
    entityId: entry.allianceId,
    entityName:
      entry.allianceName ?? (entry.allianceId ? `Alliance ${entry.allianceId}` : 'No alliance'),
  })),
)
</script>

<template>
  <section class="corporation-alliance-history-route">
    <UiStatePanel v-if="historyStatus === 'loading'" compact role="status">
      <template #icon><div class="app-scanner" aria-hidden="true" /></template>
      <p>Resolving alliance history...</p>
    </UiStatePanel>
    <UiStatePanel
      v-else-if="historyStatus === 'error'"
      code="ERR / HISTORY"
      title="Alliance history unavailable"
      compact
      role="alert"
      tone="error"
    >
      <p>{{ historyMessage }}</p>
      <template #action>
        <button class="ui-action-secondary" type="button" @click="historyQuery.refetch()">
          RETRY UPLINK
        </button>
      </template>
    </UiStatePanel>
    <UiStatePanel
      v-else-if="searchableHistory.length === 0"
      code="NO RECORDS"
      title="No alliance history"
      compact
    >
      <p>ESI returned no alliance history records for this corporation.</p>
    </UiStatePanel>
    <SearchableHistoryTimeline
      v-else
      :entries="searchableHistory"
      deleted-suffix=" (closed)"
      entity-kind="alliance"
      entity-label="alliance"
    />
  </section>
</template>
