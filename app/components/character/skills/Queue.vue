<script setup lang="ts">
import type { CharacterSkillQueue } from '../../../queries/characters'
import {
  QUEUE_WARNING_MS,
  entryProgress,
  entryRemainingMs,
  formatQueueDuration,
  queueRemainingMs,
  queueSegments,
  resolveSkillQueueState,
  romanLevel,
  trainingRatePerMinute,
} from '../../../utils/skill-queue'

const props = defineProps<{
  skillQueue: CharacterSkillQueue | undefined
  status: string
  message: string
  authorizeUrl: string
}>()

const emit = defineEmits<{ retry: [] }>()

const nowMs = ref(Date.now())
let queueTicker: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  nowMs.value = Date.now()
  queueTicker = setInterval(() => {
    nowMs.value = Date.now()
  }, 30_000)
})
onUnmounted(() => {
  if (queueTicker) clearInterval(queueTicker)
})

const queueEntries = computed(() => props.skillQueue?.entries ?? [])
const queueStatus = computed(() => resolveSkillQueueState(queueEntries.value, nowMs.value))
const queueState = computed(() => queueStatus.value.state)
const activeQueueEntry = computed(() =>
  queueEntries.value.find((entry) => entry.queuePosition === queueStatus.value.activeQueuePosition),
)
const upcomingQueueEntries = computed(() => {
  const active = queueStatus.value.activeQueuePosition
  if (active === null) return queueEntries.value
  return queueEntries.value.filter((entry) => entry.queuePosition > active)
})
const activeQueueProgress = computed(() =>
  activeQueueEntry.value ? entryProgress(activeQueueEntry.value, nowMs.value) : null,
)
const activeQueueRemaining = computed(() =>
  activeQueueEntry.value ? entryRemainingMs(activeQueueEntry.value, nowMs.value) : null,
)
const queueTotalRemaining = computed(() => queueRemainingMs(queueEntries.value, nowMs.value))
const queueBarSegments = computed(() => queueSegments(queueEntries.value))
const queueEndsSoon = computed(
  () => queueTotalRemaining.value !== null && queueTotalRemaining.value < QUEUE_WARNING_MS,
)
const queueStateLabel = computed(
  () =>
    ({ training: 'TRAINING', paused: 'PAUSED', empty: 'EMPTY', lapsed: 'COMPLETED' })[
      queueState.value
    ],
)
const queueIdleCopy = computed(() => {
  if (queueState.value === 'paused') return 'Training is paused. Restart the queue in game.'
  if (queueState.value === 'lapsed') return 'Queue finished. Trained levels update at next login.'
  return 'Nothing queued. Training time is going to waste.'
})
</script>

<template>
  <aside class="skill-queue-rail" :class="`is-${queueState}`" aria-labelledby="skill-queue-title">
    <div class="skill-queue-header">
      <h2 id="skill-queue-title">Training Queue</h2>
      <span v-if="skillQueue" class="skill-queue-count">{{ queueEntries.length }}/50</span>
      <span class="skill-queue-state">
        <i aria-hidden="true" />{{ skillQueue ? queueStateLabel : '' }}
      </span>
    </div>

    <UiStatePanel v-if="status === 'loading'" compact role="status">
      <template #icon><div class="app-scanner" aria-hidden="true" /></template>
      <p>Resolving training queue...</p>
    </UiStatePanel>
    <CharacterAuthorizationRequired
      v-else-if="status === 'scope-required'"
      compact
      title="Skill queue authorization required"
      :message="message"
      :authorize-url="authorizeUrl"
    />
    <UiStatePanel
      v-else-if="status === 'error'"
      code="ERR / QUEUE"
      title="Training queue unavailable"
      compact
      role="alert"
      tone="error"
    >
      <p>{{ message }}</p>
      <template #action>
        <button class="ui-action-secondary" type="button" @click="emit('retry')">
          RETRY UPLINK
        </button>
      </template>
    </UiStatePanel>

    <template v-else-if="skillQueue && queueState === 'training' && activeQueueEntry">
      <div class="skill-queue-current">
        <p class="skill-queue-current-identity">
          <span class="skill-queue-current-name">{{ activeQueueEntry.name }}</span>
          <span class="skill-queue-current-level">
            {{ romanLevel(activeQueueEntry.finishedLevel) }}
          </span>
          <span class="skill-queue-current-remaining">
            {{ formatQueueDuration(activeQueueRemaining) }}
          </span>
        </p>
        <progress
          class="skill-queue-progress"
          :value="activeQueueProgress?.percent ?? 0"
          max="100"
          :aria-label="`${activeQueueEntry.name} level ${activeQueueEntry.finishedLevel} training progress`"
        >
          {{ activeQueueProgress?.percent ?? 0 }}%
        </progress>
        <p class="skill-queue-current-meta">
          <span>{{ activeQueueProgress?.percent ?? 0 }}%</span>
          <span v-if="activeQueueProgress?.currentSp !== null">
            {{ activeQueueProgress?.currentSp?.toLocaleString('en-US') }} /
            {{ activeQueueProgress?.targetSp?.toLocaleString('en-US') }} SP
          </span>
          <span v-if="trainingRatePerMinute(activeQueueEntry) !== null">
            {{ trainingRatePerMinute(activeQueueEntry) }} SP/MIN
          </span>
        </p>
      </div>

      <ul v-if="upcomingQueueEntries.length" class="skill-queue-list">
        <li v-for="entry in upcomingQueueEntries" :key="entry.queuePosition">
          <span class="skill-queue-entry-name">{{ entry.name }}</span>
          <span class="skill-queue-entry-level">{{ romanLevel(entry.finishedLevel) }}</span>
          <span class="skill-queue-entry-time">
            {{ formatQueueDuration(entryRemainingMs(entry, nowMs)) }}
          </span>
        </li>
      </ul>

      <div class="skill-queue-totals">
        <div>
          <span class="ui-eyebrow">TRAINING TIME</span>
          <strong>{{ formatQueueDuration(queueTotalRemaining) }}</strong>
        </div>
        <span v-if="queueBarSegments.length" class="skill-queue-segments" aria-hidden="true">
          <i
            v-for="segment in queueBarSegments"
            :key="segment.queuePosition"
            :style="{ flex: segment.flex }"
            :class="{ 'is-current': segment.queuePosition === queueStatus.activeQueuePosition }"
          />
        </span>
        <p class="skill-queue-warning" :class="{ 'is-warning': queueEndsSoon }">
          <template v-if="queueEndsSoon">! UNDER 3 DAYS — TOP UP THE QUEUE</template>
          <template v-else>QUEUE RUNS {{ formatQueueDuration(queueTotalRemaining) }}</template>
        </p>
      </div>
    </template>

    <div v-else-if="skillQueue" class="skill-queue-idle">
      <p>{{ queueIdleCopy }}</p>
      <ul v-if="queueEntries.length" class="skill-queue-list">
        <li v-for="entry in queueEntries" :key="entry.queuePosition">
          <span class="skill-queue-entry-name">{{ entry.name }}</span>
          <span class="skill-queue-entry-level">{{ romanLevel(entry.finishedLevel) }}</span>
        </li>
      </ul>
    </div>
  </aside>
</template>
