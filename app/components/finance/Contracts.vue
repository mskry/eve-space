<script setup lang="ts">
import type {
  FinanceContract,
  FinanceContractFilter,
  FinanceContracts,
  FinanceFilterOption,
  FinanceResourceState,
} from '../../types/finance'
import {
  expiresWithinFinanceUrgency,
  financeContractValue,
  formatFinanceCollectionCount,
  formatFinanceContractType,
  formatFinanceCountdown,
  formatFinanceTerm,
} from '../../utils/finance'

const props = defineProps<{
  contractRows: readonly FinanceContract[]
  contracts: FinanceContracts | null
  emptyMessage: string
  filter: FinanceContractFilter
  filterOptions: readonly FinanceFilterOption<FinanceContractFilter>[]
  now: number
  scopeNote: string
  selectedContractId?: number
  state: FinanceResourceState
  title: string
}>()

const emit = defineEmits<{
  'change-filter': [filter: FinanceContractFilter]
  'change-page': [page: number]
  'open-contract': [contractId: number, event: MouseEvent]
  refresh: []
}>()

const selectedFilter = computed<string>({
  get: () => props.filter,
  set: (value) => emit('change-filter', value as FinanceContractFilter),
})
const countLabel = computed(() =>
  formatFinanceCollectionCount(
    props.contractRows.length,
    props.contracts?.contracts.length ?? 0,
    'loaded-page',
  ),
)
</script>

<template>
  <div class="finance-service-body">
    <FinanceServicePanel
      :has-data="Boolean(contracts)"
      :state="state"
      :title="title"
      :validated-at="contracts?.validatedAt"
      @retry="emit('refresh')"
    >
      <div class="finance-toolbar">
        <UiToggleGroup v-model="selectedFilter" label="Contract filter" :options="filterOptions" />
        <span class="finance-toolbar-note">{{ scopeNote }}</span>
      </div>
      <UiStatePanel
        v-if="contractRows.length === 0"
        code="NO CONTRACTS"
        title="Contract page empty"
        compact
        role="status"
      >
        <p>{{ emptyMessage }}</p>
      </UiStatePanel>
      <div v-else class="finance-table-scroll">
        <table class="finance-table finance-table--contracts">
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">Title</th>
              <th scope="col">Status</th>
              <th scope="col" class="is-numeric">Value</th>
              <th scope="col" class="is-numeric">Collateral</th>
              <th scope="col" class="is-numeric">Volume</th>
              <th scope="col" class="is-numeric">Expires</th>
              <th scope="col"><span class="sr-only">Open details</span></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="contract in contractRows"
              :key="contract.contractId"
              class="finance-contract-row"
              :data-state="selectedContractId === contract.contractId ? 'active' : 'inactive'"
            >
              <td class="is-mono is-subtle">{{ formatFinanceContractType(contract.type) }}</td>
              <td class="is-truncated">
                {{ contract.title || `Contract ${contract.contractId}` }}
              </td>
              <td class="is-mono" :class="`is-status-${contract.status}`">
                {{ formatFinanceContractType(contract.status) }}
              </td>
              <td class="is-numeric is-mono">{{ financeContractValue(contract) }}</td>
              <td class="is-numeric is-mono is-subtle">
                {{ formatFinanceTerm(contract.collateral) }}
              </td>
              <td class="is-numeric is-mono is-subtle">
                {{
                  contract.volume === null ? '—' : `${contract.volume.toLocaleString('en-US')} m³`
                }}
              </td>
              <td
                class="is-numeric is-mono"
                :class="
                  expiresWithinFinanceUrgency(contract.expiredAt, now) ? 'is-urgent' : 'is-subtle'
                "
              >
                {{ formatFinanceCountdown(contract.expiredAt, now) }}
              </td>
              <td class="is-numeric">
                <button
                  class="finance-open-details"
                  type="button"
                  :aria-expanded="selectedContractId === contract.contractId"
                  :aria-label="`Open details for ${contract.title || `contract ${contract.contractId}`}`"
                  @click="emit('open-contract', contract.contractId, $event)"
                >
                  ›
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <FinanceServiceFooter
        :count-label="countLabel"
        :loading="state.loading"
        :now="now"
        :page="contracts"
        page-label="Contract pages"
        :validated-at="contracts?.validatedAt"
        @change-page="emit('change-page', $event)"
        @refresh="emit('refresh')"
      />
    </FinanceServicePanel>
  </div>
</template>
