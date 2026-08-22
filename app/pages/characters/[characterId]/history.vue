<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import { useFilter } from 'reka-ui'
import { characterHistoryQuery } from '../../../queries/characters'
import { canRunProtectedQuery } from '../../../queries/query-cache'
import { ApiQueryError } from '../../../utils/query-error'

definePageMeta({ title: 'Employment History', layout: 'character' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { corporationLogo, typeImage } = useEveImages()
const { authSession } = useAuthSession(apiClient)
const characterId = computed(() => {
  const value = Array.isArray(route.params.characterId)
    ? route.params.characterId[0]
    : route.params.characterId
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
})
const historyQuery = useQuery(() => ({
  ...characterHistoryQuery({ apiClient, characterId: characterId.value ?? 0 }),
  enabled: canRunProtectedQuery(
    import.meta.client,
    authSession.value.authenticated,
    characterId.value,
  ),
}))
const history = historyQuery.data
const employment = computed(() =>
  (history.value?.history ?? []).toSorted(
    (left, right) => Date.parse(right.startDate) - Date.parse(left.startDate),
  ),
)
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
const timeline = computed(() =>
  employment.value.map((entry, index) =>
    Object.assign({}, entry, {
      endDate: index === 0 ? undefined : employment.value[index - 1]?.startDate,
    }),
  ),
)

const playerEmploymentSummary = computed(() => {
  const corporations = new Map<
    number,
    { name: string; duration: number; earliestStart: string; latestEnd: string | undefined }
  >()

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
      earliestStart:
        !current || Date.parse(entry.startDate) < Date.parse(current.earliestStart)
          ? entry.startDate
          : current.earliestStart,
      latestEnd:
        !current?.latestEnd || !entry.endDate
          ? (entry.endDate ?? current?.latestEnd)
          : !current?.latestEnd
            ? entry.endDate
            : Date.parse(entry.endDate) > Date.parse(current.latestEnd)
              ? entry.endDate
              : current.latestEnd,
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

const { contains } = useFilter({ sensitivity: 'base' })
const scroller = useTemplateRef('scroller')
const search = ref('')
const includeNpcCorporations = ref(true)
const searchTerm = computed(() => search.value.trim())
const visibleTimeline = computed(() =>
  includeNpcCorporations.value
    ? timeline.value
    : timeline.value.filter((entry) => !entry.corporation.isNpc),
)
const matches = computed(() => {
  if (!searchTerm.value) return new Set<number>()
  return new Set(
    visibleTimeline.value
      .filter(
        (entry) =>
          contains(entry.corporation.name, searchTerm.value) ||
          contains(String(entry.corporation.id), searchTerm.value),
      )
      .map((entry) => entry.recordId),
  )
})
const firstMatch = computed(
  () => visibleTimeline.value.find((entry) => matches.value.has(entry.recordId))?.recordId,
)

watch(firstMatch, async (recordId) => {
  if (recordId === undefined) return
  await nextTick()
  const target = scroller.value?.viewport?.querySelector<HTMLElement>(
    `[data-record-id="${recordId}"]`,
  )
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

function formatDuration(milliseconds: number) {
  const days = Math.floor(milliseconds / 86_400_000)
  const years = Math.floor(days / 365)
  const months = Math.floor((days % 365) / 30)

  if (years > 0) return `${years}Y${months > 0 ? ` ${months}M` : ''}`
  if (months > 0) return `${months}M ${days % 30}D`
  return `${days}D`
}
</script>

<template>
  <section class="character-history-route">
    <div
      v-if="historyStatus === 'loading' && !history"
      class="state-panel compact-state"
      aria-live="polite"
    >
      <div class="scanner" aria-hidden="true" />
      <p>Resolving corporation archive...</p>
    </div>
    <div
      v-else-if="historyStatus === 'error' || historyStatus === 'not-found'"
      class="state-panel error-panel compact-state"
      role="alert"
    >
      <span class="error-code">{{ historyStatus === 'not-found' ? '404' : 'ERR / HISTORY' }}</span>
      <h2>Employment history unavailable</h2>
      <p>{{ historyMessage }}</p>
      <button class="secondary-action" type="button" @click="historyQuery.refetch()">
        RETRY UPLINK
      </button>
    </div>
    <div v-else-if="timeline.length === 0" class="state-panel compact-state">
      <span class="error-code">NO RECORDS</span>
      <h2>No employment history</h2>
      <p>ESI returned no corporation history records for this character.</p>
    </div>
    <template v-else>
      <CharacterSummaryCard>
        <template #icon><img :src="typeImage(29205, 'icon')" alt="" aria-hidden="true" /></template>
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
      <div class="history-content">
        <UiToolbar class="history-toolbar" label="Employment history controls">
          <input
            v-model="search"
            type="search"
            autocomplete="off"
            placeholder="Search corporation name or ID"
            aria-label="Search corporation history by name or ID"
          />
          <span class="history-search-status" aria-live="polite">
            <template v-if="!searchTerm">&nbsp;</template>
            <template v-else-if="matches.size === 0">NO MATCHES</template>
            <template v-else>{{ matches.size }} / {{ visibleTimeline.length }} MATCHED</template>
          </span>
          <label class="history-npc-toggle">
            <input v-model="includeNpcCorporations" type="checkbox" />
            <span aria-hidden="true" />
            INCLUDE NPC CORPS
          </label>
        </UiToolbar>
        <UiScrollArea ref="scroller" class="employment-scroller">
          <p v-if="visibleTimeline.length === 0" class="history-empty-results">
            NPC corporations are hidden. Tick 'Include NPC corps' to view this history.
          </p>
          <ol v-else class="employment-timeline">
            <li
              v-for="entry in visibleTimeline"
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
                v-if="!entry.isDeleted"
                :src="corporationLogo(entry.corporation.id, 128)"
                :alt="`${entry.corporation.name} corporation logo`"
                width="48"
                height="48"
              />
              <span v-else class="employment-deleted-mark" aria-hidden="true">X</span>
              <div>
                <h3>
                  <NuxtLink
                    v-if="!entry.isDeleted"
                    :to="`/corporation/${entry.corporation.id}`"
                    class="employment-name-link"
                  >
                    {{ entry.corporation.name }}
                  </NuxtLink>
                  <template v-else>{{ entry.corporation.name }}</template>
                </h3>
                <p>{{ entry.corporation.id }}</p>
              </div>
              <p class="employment-period">
                <time :datetime="entry.startDate">{{ formatEmploymentDate(entry.startDate) }}</time>
                <span aria-hidden="true">→</span>
                <time v-if="entry.endDate" :datetime="entry.endDate">
                  {{ formatEmploymentDate(entry.endDate) }}
                </time>
                <strong v-else>CURRENT</strong>
              </p>
            </li>
          </ol>
        </UiScrollArea>
      </div>
    </template>
  </section>
</template>

<style scoped>
.employment-name-link {
  color: inherit;
  text-decoration: none;
}
</style>
