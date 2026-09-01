<script setup lang="ts">
type UpstreamStatus = 'operational' | 'degraded' | 'unavailable' | 'stale'

const props = defineProps<{
  status: UpstreamStatus | undefined
  checkedAt: string | undefined
  vip: boolean
}>()

const degraded = computed(
  () => props.status === 'stale' || props.status === 'unavailable' || props.status === 'degraded',
)
const headline = computed(() => {
  if (props.status === 'unavailable') return 'TRANQUILITY UNREACHABLE'
  if (props.status === 'degraded') return 'TRANQUILITY DEGRADED'
  return 'TRANQUILITY NOT RESPONDING'
})
const detail = computed(() => {
  if (props.status === 'unavailable')
    return 'Character data is unavailable until EVE Online returns.'
  if (props.status === 'degraded') return 'Character data may be delayed.'
  return 'Character data is being served from cache and may be out of date.'
})
</script>

<template>
  <output v-if="degraded" class="upstream-notice" :data-status="status">
    <span class="ui-eyebrow">{{ headline }}</span>
    <span class="upstream-notice-detail">
      {{ detail }}
      <template v-if="vip">Tranquility is in VIP mode, so sign-in may also fail.</template>
    </span>
    <span v-if="checkedAt && status !== 'unavailable'" class="upstream-notice-contact">
      LAST CONTACT
      <NuxtTime :datetime="checkedAt" hour="2-digit" minute="2-digit" />
    </span>
  </output>
</template>
