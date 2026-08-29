<script setup lang="ts">
import { useFilter } from 'reka-ui'

interface SearchableHistoryEntry {
  recordId: number
  startDate: string
  endDate: string | undefined
  isDeleted: boolean
  entityId: number | null
  entityName: string
}

const props = defineProps<{
  entries: SearchableHistoryEntry[]
  entityKind: 'alliance' | 'corporation'
  entityLabel: string
  deletedSuffix?: string
}>()

defineSlots<{
  controls(): unknown
  empty(): unknown
  'entry-name'(props: { entry: SearchableHistoryEntry }): unknown
}>()

const { contains } = useFilter({ sensitivity: 'base' })
const scroller = useTemplateRef('scroller')
const search = ref('')
const searchTerm = computed(() => search.value.trim())
const matches = computed(() => {
  if (!searchTerm.value) return new Set<number>()
  return new Set(
    props.entries
      .filter(
        (entry) =>
          contains(entry.entityName, searchTerm.value) ||
          (entry.entityId !== null && contains(String(entry.entityId), searchTerm.value)),
      )
      .map((entry) => entry.recordId),
  )
})
const firstMatch = computed(
  () => props.entries.find((entry) => matches.value.has(entry.recordId))?.recordId,
)

watch(firstMatch, async (recordId) => {
  if (recordId === undefined) return
  await nextTick()
  const target = scroller.value?.viewport?.querySelector<HTMLElement>(
    `[data-record-id="${recordId}"]`,
  )
  if (target) scroller.value?.scrollToElement(target, 12)
})

function formatHistoryDate(value: string) {
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
    <UiToolbar class="history-toolbar" :label="`${entityLabel} history controls`">
      <input
        v-model="search"
        type="search"
        autocomplete="off"
        :placeholder="`Search ${entityLabel} name or ID`"
        :aria-label="`Search ${entityLabel} history by name or ID`"
      />
      <span class="app-search-status" aria-live="polite">
        <template v-if="!searchTerm">&nbsp;</template>
        <template v-else-if="matches.size === 0">NO MATCHES</template>
        <template v-else>{{ matches.size }} / {{ entries.length }} MATCHED</template>
      </span>
      <slot name="controls" />
    </UiToolbar>

    <UiScrollArea ref="scroller" class="employment-scroller">
      <p v-if="entries.length === 0" class="history-empty-results">
        <slot name="empty">No {{ entityLabel }} history</slot>
      </p>
      <ol v-else class="employment-timeline">
        <li
          v-for="entry in entries"
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
          <UiEveImage
            v-if="!entry.isDeleted && entry.entityId"
            :kind="entityKind"
            :id="entry.entityId"
            :dimension="48"
            :alt="`${entry.entityName} ${entityLabel} logo`"
          />
          <span v-else class="employment-deleted-mark" aria-hidden="true">X</span>
          <div>
            <h3>
              <slot name="entry-name" :entry="entry">{{ entry.entityName }}</slot
              ><template v-if="entry.isDeleted">{{ deletedSuffix }}</template>
            </h3>
            <p>{{ entry.entityId ?? '—' }}</p>
          </div>
          <p class="employment-period">
            <time :datetime="entry.startDate">{{ formatHistoryDate(entry.startDate) }}</time>
            <span aria-hidden="true">→</span>
            <time v-if="entry.endDate" :datetime="entry.endDate">
              {{ formatHistoryDate(entry.endDate) }}
            </time>
            <strong v-else>CURRENT</strong>
          </p>
        </li>
      </ol>
    </UiScrollArea>
  </div>
</template>

<style>
@import url('~/assets/css/features/history-timeline.css');
@import url('~/assets/css/responsive/history-timeline.css');
</style>
