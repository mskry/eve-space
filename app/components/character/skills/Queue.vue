<script setup lang="ts">
import type { CharacterSkillQueue } from '../../../queries/characters'
import type { EsiResourceState } from '../../../types/esi-resource'
import { formatNumber } from '../../../utils/format'
import {
  QUEUE_WARNING_MS,
  entryRemainingMs,
  formatQueueDuration,
  queueRemainingMs,
  queueRemainingSp,
  queueSegments,
  resolveSkillQueueState,
  romanLevel,
} from '../../../utils/skill-queue'

const props = defineProps<{
  skillQueue: CharacterSkillQueue | undefined
  status: string
  message: string
  authorizeUrl: string
  unallocatedSp: number
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
const activeQueueRemaining = computed(() =>
  activeQueueEntry.value ? entryRemainingMs(activeQueueEntry.value, nowMs.value) : null,
)
const queueTotalRemaining = computed(() => queueRemainingMs(queueEntries.value, nowMs.value))
const queueTotalSp = computed(() => queueRemainingSp(queueEntries.value, nowMs.value))
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
const resourceState = computed<EsiResourceState>(() => {
  if (props.status === 'loading') {
    return { status: 'loading', title: '', message: 'Resolving training queue...' }
  }
  if (props.status === 'scope-required') {
    return {
      status: 'authorization-required',
      code: 'ESI 403 / QUEUE',
      title: 'Skill queue authorization required',
      message: props.message,
      action: props.authorizeUrl
        ? { href: props.authorizeUrl, label: 'AUTHORIZE THIS CHARACTER' }
        : null,
    }
  }
  if (props.status === 'error') {
    return {
      status: 'error',
      code: 'ERR / QUEUE',
      title: 'Training queue unavailable',
      message: props.message,
      retryLabel: 'RETRY UPLINK',
    }
  }
  return { status: 'ready' }
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

    <EsiResourceBoundary
      :state="resourceState"
      :has-data="Boolean(skillQueue)"
      @retry="emit('retry')"
    >
      <template v-if="skillQueue && queueState === 'training' && activeQueueEntry">
        <div class="skill-queue-current">
          <span class="skill-queue-chevron-field" aria-hidden="true">
            <i v-for="chevron in 32" :key="chevron"></i>
          </span>
          <p class="skill-queue-current-identity">
            <span
              class="skill-level-track skill-queue-current-levels"
              :aria-label="`Training level ${activeQueueEntry.finishedLevel}`"
            >
              <i
                v-for="level in 5"
                :key="level"
                :class="{
                  'is-trained': level < activeQueueEntry.finishedLevel,
                  'is-active': level === activeQueueEntry.finishedLevel,
                }"
                aria-hidden="true"
              ></i>
            </span>
            <span class="skill-queue-current-name">{{ activeQueueEntry.name }}</span>
            <span class="skill-queue-current-level">
              {{ romanLevel(activeQueueEntry.finishedLevel) }}
            </span>
            <span class="skill-queue-current-remaining">
              {{ formatQueueDuration(activeQueueRemaining) }}
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
    </EsiResourceBoundary>

    <p v-if="unallocatedSp > 0" class="skill-queue-unallocated">
      <strong>{{ formatNumber(unallocatedSp) }}</strong>
      <span class="skill-queue-unallocated-label">unallocated skill points.</span>
    </p>

    <div
      v-if="skillQueue && queueState === 'training' && activeQueueEntry"
      class="skill-queue-totals"
    >
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
      <p v-if="queueTotalSp !== null" class="skill-queue-sp-summary">
        {{ formatNumber(queueTotalSp) }} skill points in queue
      </p>
      <p v-if="queueEndsSoon" class="skill-queue-warning is-warning">
        ! UNDER 3 DAYS — TOP UP THE QUEUE
      </p>
      <p v-else-if="queueTotalSp === null" class="skill-queue-warning">
        QUEUE RUNS {{ formatQueueDuration(queueTotalRemaining) }}
      </p>
    </div>
  </aside>
</template>
