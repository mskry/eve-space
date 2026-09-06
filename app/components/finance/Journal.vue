<script setup lang="ts">
import type {
  FinanceJournal,
  FinanceJournalEntry,
  FinanceJournalGroupFilter,
  FinanceResourceState,
} from '../../types/finance'
import {
  formatFinanceCollectionCount,
  formatFinanceContractType,
  formatFinanceDate,
  formatFinanceIsk,
  formatSignedFinanceIsk,
} from '../../utils/finance'

const props = defineProps<{
  entries: readonly FinanceJournalEntry[]
  filter: FinanceJournalGroupFilter
  journal: FinanceJournal | null
  now: number
  scopeNote: string
  state: FinanceResourceState
}>()

const emit = defineEmits<{
  'change-filter': [filter: FinanceJournalGroupFilter]
  'change-page': [page: number]
  refresh: []
}>()

const filterOptions: ReadonlyArray<{ label: string; value: FinanceJournalGroupFilter }> = [
  { value: 'All', label: 'All' },
  { value: 'Income', label: 'Income' },
  { value: 'Expense', label: 'Expense' },
  { value: 'Market', label: 'Market' },
  { value: 'Contracts', label: 'Contracts' },
]
const selectedFilter = computed<string>({
  get: () => props.filter,
  set: (value) => emit('change-filter', value as FinanceJournalGroupFilter),
})
const countLabel = computed(() =>
  formatFinanceCollectionCount(
    props.entries.length,
    props.journal?.entries.length ?? 0,
    'loaded-page',
  ),
)
</script>

<template>
  <div class="finance-service-body">
    <FinanceServicePanel
      :has-data="Boolean(journal)"
      :state="state"
      title="Wallet journal"
      :validated-at="journal?.validatedAt"
      @retry="emit('refresh')"
    >
      <div class="finance-toolbar">
        <UiToggleGroup
          v-model="selectedFilter"
          label="Journal reference type"
          :options="filterOptions"
        />
        <span class="finance-toolbar-note">{{ scopeNote }}</span>
      </div>
      <output class="sr-only" aria-live="polite">{{ countLabel }}</output>
      <UiStatePanel
        v-if="entries.length === 0"
        code="NO ENTRIES"
        title="Journal page empty"
        compact
        role="status"
      >
        <p>No journal entries on the loaded page match this range and filter.</p>
      </UiStatePanel>
      <div v-else class="finance-table-scroll">
        <table class="finance-table finance-table--journal">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Ref type</th>
              <th scope="col">Description</th>
              <th scope="col" class="is-numeric">Amount</th>
              <th scope="col" class="is-numeric">Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in entries" :key="entry.journalId">
              <td class="is-mono">{{ formatFinanceDate(entry.date) }}</td>
              <td>{{ formatFinanceContractType(entry.referenceType) }}</td>
              <td class="is-truncated">{{ entry.description }}</td>
              <td
                class="is-numeric is-mono"
                :class="(entry.amount ?? 0) > 0 ? 'is-income' : 'is-expense'"
              >
                {{ formatSignedFinanceIsk(entry.amount) }}
              </td>
              <td class="is-numeric is-mono is-subtle">
                {{ entry.balance === null ? 'UNAVAILABLE' : formatFinanceIsk(entry.balance) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <FinanceServiceFooter
        :count-label="countLabel"
        :loading="state.loading"
        :now="now"
        :page="journal"
        page-label="Journal pages"
        :validated-at="journal?.validatedAt"
        @change-page="emit('change-page', $event)"
        @refresh="emit('refresh')"
      />
    </FinanceServicePanel>
  </div>
</template>
