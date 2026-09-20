<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    buttonClass?: string
    currentPage: number
    disabled?: boolean
    hasNext: boolean
    hasPrevious: boolean
    label: string
    nextLabel?: string
    previousLabel?: string
    showStatus?: boolean
  }>(),
  {
    buttonClass: undefined,
    disabled: false,
    nextLabel: 'Next page',
    previousLabel: 'Previous page',
    showStatus: true,
  },
)

const emit = defineEmits<{
  next: []
  previous: []
}>()
</script>

<template>
  <nav class="ui-pagination" :aria-label="props.label">
    <button
      :class="['ui-pagination-button', props.buttonClass]"
      type="button"
      :aria-label="props.previousLabel"
      :disabled="props.disabled || !props.hasPrevious"
      @click="emit('previous')"
    >
      <slot name="previous">Previous</slot>
    </button>
    <span :class="['ui-pagination-status', { 'sr-only': !props.showStatus }]" aria-current="page">
      Page <strong>{{ props.currentPage }}</strong>
    </span>
    <button
      :class="['ui-pagination-button', props.buttonClass]"
      type="button"
      :aria-label="props.nextLabel"
      :disabled="props.disabled || !props.hasNext"
      @click="emit('next')"
    >
      <slot name="next">Next</slot>
    </button>
  </nav>
</template>
