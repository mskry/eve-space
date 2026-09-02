<script setup lang="ts">
import type { FinancePageMetadata } from '../../types/finance'
import { formatFinanceSynced } from '../../utils/finance'

interface FinanceContinuationNavigation {
  hasNewer: boolean
  hasOlder: boolean
  rangeIndex: number
}

const props = withDefaults(
  defineProps<{
    countLabel: string
    loading: boolean
    now: number
    page?: FinancePageMetadata | null
    pageLabel?: string
    continuation?: FinanceContinuationNavigation | null
    refreshable?: boolean
    validatedAt?: string
  }>(),
  {
    continuation: null,
    page: null,
    pageLabel: 'Finance pages',
    refreshable: true,
    validatedAt: '',
  },
)

const emit = defineEmits<{
  'change-page': [page: number]
  'load-older': []
  refresh: []
  'show-newer': []
}>()
</script>

<template>
  <div class="finance-table-footer">
    <span class="finance-footer-scope">
      {{ countLabel }}
      <template v-if="page"> · PAGE {{ page.page }} / {{ page.totalPages }}</template>
      <template v-if="continuation"> · RANGE {{ continuation.rangeIndex + 1 }}</template>
      · SYNCED {{ formatFinanceSynced(validatedAt, now) }}
    </span>
    <div class="finance-footer-actions">
      <button
        v-if="refreshable"
        class="finance-ghost-button"
        type="button"
        :disabled="loading"
        @click="emit('refresh')"
      >
        REFRESH
      </button>
      <UiPagination
        v-if="page"
        button-class="finance-ghost-button"
        :current-page="page.page"
        :disabled="loading"
        :label="pageLabel"
        next-label="NEXT"
        previous-label="PREV"
        :show-status="false"
        :total-pages="page.totalPages"
        @change-page="emit('change-page', $event)"
      >
        <template #previous>PREV</template>
        <template #next>NEXT</template>
      </UiPagination>
      <template v-if="continuation">
        <button
          class="finance-ghost-button"
          type="button"
          :disabled="loading || !continuation.hasNewer"
          @click="emit('show-newer')"
        >
          NEWER
        </button>
        <button
          class="finance-ghost-button"
          type="button"
          :disabled="loading || !continuation.hasOlder"
          @click="emit('load-older')"
        >
          OLDER
        </button>
      </template>
    </div>
  </div>
</template>
