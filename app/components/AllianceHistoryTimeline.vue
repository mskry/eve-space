<script setup lang="ts">
import { useFilter } from 'reka-ui'

interface AllianceHistoryEntry {
  recordId: number
  startDate: string
  isDeleted: boolean
  allianceId: number | null
  allianceName: string | null
}

const props = defineProps<{ history: AllianceHistoryEntry[] }>()

const { allianceLogo } = useEveImages()
const { contains } = useFilter({ sensitivity: 'base' })
const scroller = useTemplateRef('scroller')
const search = ref('')
const searchTerm = computed(() => search.value.trim())

const sorted = computed(() =>
  [...props.history].toSorted((a, b) => Date.parse(b.startDate) - Date.parse(a.startDate)),
)

const timeline = computed(() =>
  sorted.value.map((entry, index) =>
    Object.assign({}, entry, {
      endDate: index === 0 ? undefined : sorted.value[index - 1]?.startDate,
      displayName:
        entry.allianceName ?? (entry.allianceId ? `Alliance ${entry.allianceId}` : 'No alliance'),
    }),
  ),
)

const matches = computed(() => {
  if (!searchTerm.value) return new Set<number>()
  return new Set(
    timeline.value
      .filter(
        (e) =>
          contains(e.displayName, searchTerm.value) ||
          (e.allianceId !== null && contains(String(e.allianceId), searchTerm.value)),
      )
      .map((e) => e.recordId),
  )
})

const firstMatch = computed(
  () => timeline.value.find((e) => matches.value.has(e.recordId))?.recordId,
)

watch(firstMatch, async (id) => {
  if (id === undefined) return
  await nextTick()
  const target = scroller.value?.viewport?.querySelector<HTMLElement>(`[data-record-id="${id}"]`)
  if (target) scroller.value?.scrollToElement(target, 12)
})

function formatEmploymentDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value))
}
</script>

<template>
  <div class="history-content">
    <UiToolbar class="history-toolbar" label="Alliance history controls">
      <input
        v-model="search"
        type="search"
        autocomplete="off"
        placeholder="Search alliance name or ID"
        aria-label="Search alliance history by name or ID"
      />
      <span class="app-search-status" aria-live="polite">
        <template v-if="!searchTerm">&nbsp;</template>
        <template v-else-if="matches.size === 0">NO MATCHES</template>
        <template v-else>{{ matches.size }} / {{ timeline.length }} MATCHED</template>
      </span>
    </UiToolbar>

    <UiScrollArea ref="scroller" class="employment-scroller">
      <p v-if="timeline.length === 0" class="history-empty-results">No alliance history</p>
      <ol v-else class="employment-timeline">
        <li
          v-for="entry in timeline"
          :key="entry.recordId"
          :data-record-id="entry.recordId"
          :class="{
            'is-match': matches.has(entry.recordId),
            'is-muted': Boolean(searchTerm) && !matches.has(entry.recordId),
          }"
        >
          <span
            class="employment-marker"
            :class="{ 'is-current': !entry.endDate }"
            aria-hidden="true"
          />
          <img
            v-if="!entry.isDeleted && entry.allianceId"
            :src="allianceLogo(entry.allianceId, 128)"
            :alt="`${entry.displayName} alliance logo`"
            width="48"
            height="48"
          />
          <span v-else class="employment-deleted-mark" aria-hidden="true">X</span>
          <div>
            <h3>{{ entry.displayName }}<template v-if="entry.isDeleted"> (closed)</template></h3>
            <p>{{ entry.allianceId ?? '—' }}</p>
          </div>
          <p class="employment-period">
            <time :datetime="entry.startDate">{{ formatEmploymentDate(entry.startDate) }}</time>
            <span aria-hidden="true">→</span>
            <time v-if="entry.endDate" :datetime="entry.endDate">{{
              formatEmploymentDate(entry.endDate)
            }}</time>
            <strong v-else>CURRENT</strong>
          </p>
        </li>
      </ol>
    </UiScrollArea>
  </div>
</template>

<style>
@import url('~/assets/css/features/history.css');
@import url('~/assets/css/responsive/history.css');
</style>
