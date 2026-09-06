<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    currentPage: number
    disabled?: boolean
    label: string
    nextLabel?: string
    previousLabel?: string
    totalPages: number
  }>(),
  {
    disabled: false,
    nextLabel: 'Next page',
    previousLabel: 'Previous page',
  },
)

const emit = defineEmits<{
  'change-page': [page: number]
}>()

function changePage(page: number) {
  if (props.disabled || page < 1 || page > props.totalPages) return
  emit('change-page', page)
}
</script>

<template>
  <nav class="platform-pagination" :aria-label="label">
    <button
      type="button"
      :aria-label="previousLabel"
      :disabled="disabled || currentPage <= 1"
      @click="changePage(currentPage - 1)"
    >
      <slot name="previous">Previous</slot>
    </button>
    <span aria-current="page">Page {{ currentPage }} of {{ totalPages }}</span>
    <button
      type="button"
      :aria-label="nextLabel"
      :disabled="disabled || currentPage >= totalPages"
      @click="changePage(currentPage + 1)"
    >
      <slot name="next">Next</slot>
    </button>
  </nav>
</template>

<style scoped>
.platform-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
</style>
