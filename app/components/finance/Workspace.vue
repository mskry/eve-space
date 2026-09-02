<script setup lang="ts">
import type { FinanceRange } from '../../types/finance'
import { FINANCE_RANGES } from '../../utils/finance'

type FinanceService = 'journal' | 'transactions' | 'orders' | 'contracts'

const props = withDefaults(
  defineProps<{
    activeService: FinanceService
    range: FinanceRange
    serviceBadges?: Partial<Record<FinanceService, number>>
  }>(),
  {
    serviceBadges: () => ({}),
  },
)

const emit = defineEmits<{
  'activate-service': [service: FinanceService]
  'change-range': [range: FinanceRange]
}>()

defineSlots<{
  contracts(): unknown
  journal(): unknown
  orders(): unknown
  transactions(): unknown
}>()

const services: ReadonlyArray<{ label: string; value: FinanceService }> = [
  { value: 'journal', label: 'Journal' },
  { value: 'transactions', label: 'Transactions' },
  { value: 'orders', label: 'Orders' },
  { value: 'contracts', label: 'Contracts' },
]
const rangeOptions = FINANCE_RANGES.map((value) => ({ value, label: value }))
const selectedService = computed<string>({
  get: () => props.activeService,
  set: (value) => emit('activate-service', value as FinanceService),
})
const selectedRange = computed<string>({
  get: () => props.range,
  set: (value) => emit('change-range', value as FinanceRange),
})

function serviceBadge(service: string) {
  return props.serviceBadges[service as FinanceService] ?? 0
}
</script>

<template>
  <section class="finance-ledger" aria-labelledby="finance-ledger-title">
    <header class="finance-ledger-header">
      <h2 id="finance-ledger-title">Finance ledger</h2>
      <div class="finance-range">
        <span class="finance-range-label">Range</span>
        <UiToggleGroup v-model="selectedRange" label="Loaded data range" :options="rangeOptions" />
      </div>
    </header>

    <UiTabs
      v-model="selectedService"
      aria-label="Finance services"
      content-class="finance-tab-panel"
      list-class="finance-tabs"
      :tabs="services"
      unmount-on-hide
    >
      <template #trigger="slotProps">
        {{ slotProps?.tab.label }}
        <span v-if="serviceBadge(slotProps?.tab.value ?? '') > 0" class="finance-tab-badge">
          {{ serviceBadge(slotProps?.tab.value ?? '') }}
        </span>
      </template>

      <template #journal><slot name="journal" /></template>
      <template #transactions><slot name="transactions" /></template>
      <template #orders><slot name="orders" /></template>
      <template #contracts><slot name="contracts" /></template>
    </UiTabs>
  </section>
</template>
