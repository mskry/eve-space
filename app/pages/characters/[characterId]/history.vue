<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import { characterHistoryQuery } from '../../../queries/characters'
import { canRunProtectedQuery } from '../../../queries/query-cache'
import { buildHistoryTimeline } from '../../../utils/history-timeline'
import { ApiQueryError } from '../../../utils/query-error'
import { parseRouteId } from '../../../utils/route-id'

interface EmploymentSummary {
  name: string
  duration: number
  earliestStart: string
  latestEnd: string | undefined
}

definePageMeta({ title: 'Employment History', layout: 'headerless' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { authSession } = useAuthSession(apiClient)
const characterId = computed(() => parseRouteId(route.params.characterId))
const historyQuery = useQuery(() => ({
  ...characterHistoryQuery({ apiClient, characterId: characterId.value ?? 0 }),
  enabled: canRunProtectedQuery(
    import.meta.client,
    authSession.value.authenticated,
    characterId.value,
  ),
}))
const history = historyQuery.data
const historyMessage = computed(() =>
  historyQuery.error.value instanceof Error ? historyQuery.error.value.message : '',
)
const historyStatus = computed(() => {
  if (historyQuery.data.value) return 'idle'
  if (
    historyQuery.error.value instanceof ApiQueryError &&
    historyQuery.error.value.status === 404
  ) {
    return 'not-found'
  }
  if (historyQuery.status.value === 'error') return 'error'
  if (historyQuery.asyncStatus.value === 'loading') return 'loading'
  return 'idle'
})
const timeline = computed(() => buildHistoryTimeline(history.value?.history ?? []))

const playerEmploymentSummary = computed(() => {
  const corporations = new Map<number, EmploymentSummary>()

  for (const entry of timeline.value) {
    if (entry.corporation.isNpc || entry.isDeleted) continue
    const duration = Math.max(
      0,
      Date.parse(entry.endDate ?? new Date().toISOString()) - Date.parse(entry.startDate),
    )
    const current = corporations.get(entry.corporation.id)
    corporations.set(entry.corporation.id, {
      name: entry.corporation.name,
      duration: (current?.duration ?? 0) + duration,
      earliestStart: earliestStart(current, entry.startDate),
      latestEnd: latestEnd(current, entry.endDate),
    })
  }

  // latestEnd stays undefined if any stint is still open (current corp)
  for (const [id, data] of corporations) {
    const hasOpen = timeline.value.some(
      (e) => e.corporation.id === id && !e.endDate && !e.corporation.isNpc,
    )
    if (hasOpen) data.latestEnd = undefined
  }

  return [...corporations.values()].toSorted(
    (left, right) => right.duration - left.duration || left.name.localeCompare(right.name),
  )[0]
})

function earliestStart(current: EmploymentSummary | undefined, startDate: string) {
  if (!current || Date.parse(startDate) < Date.parse(current.earliestStart)) return startDate
  return current.earliestStart
}

function latestEnd(current: EmploymentSummary | undefined, endDate: string | undefined) {
  const currentEnd = current?.latestEnd
  if (!currentEnd || !endDate) return endDate ?? currentEnd
  return Date.parse(endDate) > Date.parse(currentEnd) ? endDate : currentEnd
}

const longestNpcInterlude = computed(() => {
  let longest:
    | { duration: number; from: string; to: string; fromDate: string; toDate: string }
    | undefined

  for (let index = 0; index < timeline.value.length; index += 1) {
    const playerEntry = timeline.value[index]
    if (!playerEntry || playerEntry.corporation.isNpc || playerEntry.isDeleted) continue

    let npcIndex = index + 1
    while (timeline.value[npcIndex]?.corporation.isNpc) npcIndex += 1
    const earliestNpcEntry = timeline.value[npcIndex - 1]
    if (!earliestNpcEntry || npcIndex === index + 1) continue

    const duration = Math.max(
      0,
      Date.parse(playerEntry.startDate) - Date.parse(earliestNpcEntry.startDate),
    )
    if (!longest || duration > longest.duration) {
      longest = {
        duration,
        from: earliestNpcEntry.corporation.name,
        to: playerEntry.corporation.name,
        fromDate: earliestNpcEntry.startDate,
        toDate: playerEntry.startDate,
      }
    }
  }

  return longest
})

const currentCorporation = computed(() => timeline.value[0]?.corporation ?? undefined)

const includeNpcCorporations = ref(true)
const visibleTimeline = computed(() =>
  includeNpcCorporations.value
    ? timeline.value
    : timeline.value.filter((entry) => !entry.corporation.isNpc),
)
const searchableTimeline = computed(() =>
  visibleTimeline.value.map((entry) => ({
    recordId: entry.recordId,
    startDate: entry.startDate,
    endDate: entry.endDate,
    isDeleted: entry.isDeleted,
    entityId: entry.corporation.id,
    entityName: entry.corporation.name,
  })),
)

function formatEmploymentDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value))
}

function formatDuration(milliseconds: number) {
  const days = Math.floor(milliseconds / 86_400_000)
  const years = Math.floor(days / 365)
  const months = Math.floor((days % 365) / 30)

  if (years > 0) {
    const monthDuration = months > 0 ? ` ${months}M` : ''
    return `${years}Y${monthDuration}`
  }
  if (months > 0) return `${months}M ${days % 30}D`
  return `${days}D`
}
</script>

<template>
  <section class="character-history-route">
    <UiStatePanel v-if="historyStatus === 'loading' && !history" compact role="status">
      <template #icon><div class="app-scanner" aria-hidden="true" /></template>
      <p>Resolving corporation archive...</p>
    </UiStatePanel>
    <UiStatePanel
      v-else-if="historyStatus === 'error' || historyStatus === 'not-found'"
      :code="historyStatus === 'not-found' ? '404' : 'ERR / HISTORY'"
      title="Employment history unavailable"
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
      v-else-if="timeline.length === 0"
      code="NO RECORDS"
      title="No employment history"
      compact
    >
      <p>ESI returned no corporation history records for this character.</p>
    </UiStatePanel>
    <template v-else>
      <CharacterSummaryCard>
        <template #icon>
          <UiEveImage kind="type-icon" :id="29205" :dimension="42" alt="" aria-hidden="true" />
        </template>
        <template #eyebrow>EMPLOYMENT HISTORY</template>
        <template #value>{{ currentCorporation?.name ?? 'NO RECORDS' }}</template>
        <template #label>CURRENT CORPORATION</template>

        <dl class="history-summary-stats">
          <div>
            <dt>RECORDS</dt>
            <dd>{{ timeline.length }}</dd>
          </div>
          <UiTooltip v-if="playerEmploymentSummary">
            <template #content>
              <div class="history-interlude-tooltip">
                <div>{{ playerEmploymentSummary.name }}</div>
                <div class="history-interlude-tooltip-dates">
                  {{ formatEmploymentDate(playerEmploymentSummary.earliestStart) }} →
                  <template v-if="playerEmploymentSummary.latestEnd">{{
                    formatEmploymentDate(playerEmploymentSummary.latestEnd)
                  }}</template>
                  <template v-else>CURRENT</template>
                </div>
              </div>
            </template>
            <div>
              <dt>LONGEST SERVICE</dt>
              <dd>{{ formatDuration(playerEmploymentSummary.duration) }}</dd>
            </div>
          </UiTooltip>
          <UiTooltip v-if="longestNpcInterlude">
            <template #content>
              <div class="history-interlude-tooltip">
                <div>{{ longestNpcInterlude.from }} → {{ longestNpcInterlude.to }}</div>
                <div class="history-interlude-tooltip-dates">
                  {{ formatEmploymentDate(longestNpcInterlude.fromDate) }} →
                  {{ formatEmploymentDate(longestNpcInterlude.toDate) }}
                </div>
              </div>
            </template>
            <div>
              <dt>LONGEST NPC INTERLUDE</dt>
              <dd>{{ formatDuration(longestNpcInterlude.duration) }}</dd>
            </div>
          </UiTooltip>
        </dl>
      </CharacterSummaryCard>
      <SearchableHistoryTimeline
        :entries="searchableTimeline"
        entity-kind="corporation"
        entity-label="corporation"
      >
        <template #controls>
          <label class="history-npc-toggle">
            <input v-model="includeNpcCorporations" type="checkbox" />
            <span aria-hidden="true" />
            INCLUDE NPC CORPS
          </label>
        </template>
        <template #empty>
          NPC corporations are hidden. Tick 'Include NPC corps' to view this history.
        </template>
        <template #entry-name="{ entry }">
          <NuxtLink
            v-if="!entry.isDeleted && entry.entityId"
            :to="`/corporation/${entry.entityId}`"
            class="employment-name-link"
          >
            {{ entry.entityName }}
          </NuxtLink>
          <template v-else>{{ entry.entityName }}</template>
        </template>
      </SearchableHistoryTimeline>
    </template>
  </section>
</template>

<style>
@import url('~/assets/css/features/history.css');
@import url('~/assets/css/responsive/history.css');
</style>

<style scoped>
.employment-name-link {
  color: inherit;
  text-decoration: none;
}
</style>
