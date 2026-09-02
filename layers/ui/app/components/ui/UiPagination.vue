<script setup lang="ts">
import { PaginationNext, PaginationPrev, PaginationRoot } from 'reka-ui'

const props = withDefaults(
  defineProps<{
    buttonClass?: string
    currentPage: number
    disabled?: boolean
    label: string
    nextLabel?: string
    previousLabel?: string
    showStatus?: boolean
    totalPages: number
  }>(),
  {
    disabled: false,
    buttonClass: undefined,
    nextLabel: 'Next page',
    previousLabel: 'Previous page',
    showStatus: true,
  },
)

const emit = defineEmits<{
  'change-page': [page: number]
}>()

const previousDisabled = computed(() => props.disabled || props.currentPage <= 1)
const nextDisabled = computed(() => props.disabled || props.currentPage >= props.totalPages)

function changePage(page: number) {
  if (
    props.disabled ||
    page < 1 ||
    page > props.totalPages ||
    Math.abs(page - props.currentPage) !== 1
  ) {
    return
  }

  emit('change-page', page)
}
</script>

<template>
  <PaginationRoot
    class="ui-pagination"
    :aria-label="label"
    :disabled="disabled"
    :items-per-page="1"
    :page="currentPage"
    :total="totalPages"
    @update:page="changePage"
  >
    <PaginationPrev
      :class="['ui-pagination-button', buttonClass]"
      :aria-label="previousLabel"
      :disabled="previousDisabled"
    >
      <slot name="previous">Previous</slot>
    </PaginationPrev>
    <span :class="['ui-pagination-status', { 'sr-only': !showStatus }]" aria-current="page">
      Page <strong>{{ currentPage }}</strong> of <strong>{{ totalPages }}</strong>
    </span>
    <PaginationNext
      :class="['ui-pagination-button', buttonClass]"
      :aria-label="nextLabel"
      :disabled="nextDisabled"
    >
      <slot name="next">Next</slot>
    </PaginationNext>
  </PaginationRoot>
</template>
