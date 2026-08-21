<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import { characterHistoryQuery } from '../../../queries/characters'
import { canRunProtectedQuery } from '../../../queries/query-cache'
import { ApiQueryError } from '../../../utils/query-error'

definePageMeta({ title: 'Employment History' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { corporationLogo } = useEveImages()
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
const employment = computed(() => history.value?.history ?? [])
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
      <header class="history-heading">
        <div>
          <span>EMPLOYMENT RECORD</span>
          <h2>Corporation history</h2>
        </div>
        <strong>{{ timeline.length }} RECORDS</strong>
      </header>
      <ol class="employment-timeline">
        <li v-for="entry in timeline" :key="entry.recordId">
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
            <h3>{{ entry.corporation.name }}</h3>
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
    </template>
  </section>
</template>
