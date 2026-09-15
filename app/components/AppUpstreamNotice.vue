<script setup lang="ts">
import type { EsiQueryPersistencePresentation } from '@eve-space/platform-module-nuxt/runtime'

type UpstreamStatus = 'operational' | 'degraded' | 'unavailable' | 'partial' | 'stale'

const props = withDefaults(
  defineProps<{
    status: UpstreamStatus | undefined
    checkedAt: string | undefined
    presentation?: EsiQueryPersistencePresentation
    vip: boolean
  }>(),
  { presentation: () => ({ kind: 'fresh' }) },
)

const degraded = computed(
  () =>
    props.status === 'unavailable' ||
    props.status === 'partial' ||
    props.status === 'degraded' ||
    props.status === 'stale' ||
    props.presentation.kind === 'restored-refresh-failed' ||
    props.presentation.kind === 'server-stale',
)
const headline = computed(() => {
  if (props.status === 'unavailable') return 'TRANQUILITY UNREACHABLE'
  if (props.status === 'partial') return 'CHARACTER DATA DEGRADED'
  if (props.status === 'degraded') return 'TRANQUILITY DEGRADED'
  if (props.status === 'stale') return 'TRANQUILITY NOT RESPONDING'
  if (props.presentation.kind === 'restored-refresh-failed')
    return 'HISTORICAL DATA / REFRESH FAILED'
  return 'SERVER CACHE DEGRADED'
})
const detail = computed(() => {
  if (props.status === 'unavailable')
    return 'Live character updates are unavailable. Previously loaded data may be shown from cache.'
  if (props.status === 'partial') return 'Some character data is temporarily unavailable.'
  if (props.status === 'degraded') return 'Character data may be delayed.'
  if (props.status === 'stale')
    return 'Character data is being served from cache and may be out of date.'
  if (props.presentation.kind === 'restored-refresh-failed')
    return 'Previously loaded browser data remains available after its live refresh failed.'
  return 'The server is serving its last validated ESI representation.'
})
const presentationTimestamp = computed(() => {
  if (props.presentation.kind === 'fresh' || props.presentation.kind === 'restored')
    return undefined
  if (props.presentation.kind === 'server-stale')
    return props.presentation.validatedAt ?? props.presentation.originalSuccessAt
  return props.presentation.originalSuccessAt
})
const presentationTimestampLabel = computed(() =>
  props.presentation.kind === 'server-stale' ? 'LAST VALIDATED' : 'ORIGINAL SUCCESS',
)
const presentationLabel = computed(() => {
  if (props.presentation.kind === 'restored-refresh-failed')
    return 'DATA STATE / RESTORED SNAPSHOT / REFRESH FAILED'
  if (props.presentation.kind === 'server-stale') return 'DATA STATE / SERVER STALE'
  return undefined
})
const displayStatus = computed(() =>
  props.status === 'unavailable' ||
  props.status === 'partial' ||
  props.status === 'degraded' ||
  props.status === 'stale'
    ? props.status
    : props.presentation.kind,
)
</script>

<template>
  <output
    v-if="degraded"
    class="upstream-notice"
    :data-status="displayStatus"
    :data-persistence-state="presentation.kind"
    aria-live="polite"
  >
    <span class="ui-eyebrow">{{ headline }}</span>
    <span class="upstream-notice-detail">
      {{ detail }}
      <template v-if="vip">Tranquility is in VIP mode, so sign-in may also fail.</template>
    </span>
    <span v-if="presentationLabel" class="upstream-notice-contact">
      {{ presentationLabel }}
    </span>
    <span v-if="presentationTimestamp" class="upstream-notice-contact">
      {{ presentationTimestampLabel }}
      <time :datetime="presentationTimestamp">{{ presentationTimestamp }}</time>
    </span>
    <span
      v-else-if="checkedAt && status !== 'unavailable' && status !== 'partial'"
      class="upstream-notice-contact"
    >
      LAST CONTACT <time :datetime="checkedAt">{{ checkedAt }}</time>
    </span>
    <span
      v-if="presentation.kind === 'restored-refresh-failed' && presentation.retryAt"
      class="upstream-notice-contact"
    >
      RETRY AFTER <time :datetime="presentation.retryAt">{{ presentation.retryAt }}</time>
    </span>
    <span
      v-else-if="presentation.kind === 'server-stale' && presentation.retryAt"
      class="upstream-notice-contact"
    >
      RETRY AFTER <time :datetime="presentation.retryAt">{{ presentation.retryAt }}</time>
    </span>
    <span
      v-if="
        presentation.kind === 'restored-refresh-failed' &&
        (presentation.refreshFailureCode || presentation.refreshFailureStatus)
      "
      class="upstream-notice-contact"
    >
      REFRESH FAILURE
      {{ presentation.refreshFailureCode ?? `HTTP ${presentation.refreshFailureStatus}` }}
    </span>
    <span
      v-else-if="presentation.kind === 'server-stale' && presentation.refreshFailureClass"
      class="upstream-notice-contact"
    >
      REFRESH FAILURE {{ presentation.refreshFailureClass }}
    </span>
  </output>
</template>
