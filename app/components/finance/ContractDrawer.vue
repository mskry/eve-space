<script setup lang="ts">
import type {
  FinanceContract,
  FinanceContractBids,
  FinanceContractItems,
  FinanceResourceState,
} from '../../types/finance'
import {
  financeContractHasItems,
  financeContractValue,
  formatFinanceContractType,
  formatFinanceCountdown,
  formatFinanceDate,
  formatFinanceIsk,
  formatFinanceTerm,
  toFinanceEsiResourceState,
} from '../../utils/finance'

const props = defineProps<{
  bidPrivacyNote: string
  bidState: FinanceResourceState
  bids: FinanceContractBids | null
  contract: FinanceContract | null
  description: string
  itemState: FinanceResourceState
  items: FinanceContractItems | null
  now: number
  open: boolean
}>()

const emit = defineEmits<{
  'close-contract': []
  'retry-bids': []
  'retry-items': []
  'show-in-journal': []
}>()

const drawerOpen = computed({
  get: () => props.open,
  set: (open: boolean) => {
    if (!open) emit('close-contract')
  },
})
const drawerTitle = computed(
  () =>
    props.contract?.title ||
    (props.contract ? formatFinanceContractType(props.contract.type) : 'Contract details'),
)
const itemResourceState = computed(() => {
  const state = toFinanceEsiResourceState(props.itemState, 'Contract items')
  if (state.status === 'authorization-required') {
    return {
      ...state,
      code: 'ESI 403 / CONTRACT ITEMS',
      retryLabel: state.action ? undefined : 'RETRY',
    }
  }
  if (state.status === 'error') {
    return { ...state, code: props.itemState.errorCode ?? 'ERR / ITEMS' }
  }
  return state
})
const bidResourceState = computed(() => {
  const state = toFinanceEsiResourceState(props.bidState, 'Auction bids')
  if (state.status === 'authorization-required') {
    return {
      ...state,
      code: 'ESI 403 / CONTRACT BIDS',
      retryLabel: state.action ? undefined : 'RETRY',
    }
  }
  if (state.status === 'error') {
    return { ...state, code: props.bidState.errorCode ?? 'ERR / BIDS' }
  }
  return state
})
</script>

<template>
  <UiDrawer
    v-model:open="drawerOpen"
    close-label="Close contract details"
    content-class="finance-drawer"
    :description="description"
    side="right"
    :title="drawerTitle"
  >
    <template v-if="contract">
      <div class="finance-drawer-body">
        <header class="finance-drawer-heading">
          <p class="ui-eyebrow">
            {{ formatFinanceContractType(contract.type) }} ·
            {{ formatFinanceContractType(contract.status) }}
          </p>
          <h2>{{ contract.title || formatFinanceContractType(contract.type) }}</h2>
          <span class="finance-drawer-id">CONTRACT {{ contract.contractId }}</span>
        </header>

        <dl class="finance-drawer-meta">
          <div>
            <dt>{{ contract.price === null ? 'Reward' : 'Price' }}</dt>
            <dd>{{ financeContractValue(contract) }}</dd>
          </div>
          <div>
            <dt>Collateral</dt>
            <dd :class="{ 'is-urgent': (contract.collateral ?? 0) > 0 }">
              {{ formatFinanceTerm(contract.collateral) }}
            </dd>
          </div>
          <div>
            <dt>Volume</dt>
            <dd>
              {{ contract.volume === null ? '—' : `${contract.volume.toLocaleString('en-US')} m³` }}
            </dd>
          </div>
          <div>
            <dt>Availability</dt>
            <dd>{{ formatFinanceContractType(contract.availability) }}</dd>
          </div>
          <div>
            <dt>Issued</dt>
            <dd>{{ formatFinanceDate(contract.issuedAt) }}</dd>
          </div>
          <div>
            <dt>{{ contract.daysToComplete ? 'Days to complete' : 'Expires' }}</dt>
            <dd>
              {{
                contract.daysToComplete
                  ? `${contract.daysToComplete} days`
                  : formatFinanceCountdown(contract.expiredAt, now)
              }}
            </dd>
          </div>
        </dl>

        <section v-if="financeContractHasItems(contract.type)" class="finance-drawer-section">
          <header>
            <span class="finance-drawer-section-label">Items</span>
            <span class="finance-drawer-section-note">FETCHED ON OPEN</span>
          </header>
          <EsiResourceBoundary
            :state="itemResourceState"
            :has-data="Boolean(items)"
            @retry="emit('retry-items')"
          >
            <p v-if="items && items.items.length === 0" class="finance-drawer-empty">
              No item records apply to this contract.
            </p>
            <ul v-else-if="items" class="finance-drawer-list">
              <li v-for="item in items.items" :key="item.recordId">
                <span class="finance-drawer-direction" :class="`is-${item.direction}`">
                  {{ item.direction.toLocaleUpperCase('en-US') }}
                </span>
                <FinanceItemIdentity :name="item.typeName" :type-id="item.typeId" />
                <span v-if="item.blueprint" class="finance-drawer-blueprint">
                  BLUEPRINT {{ item.blueprint.toLocaleUpperCase('en-US') }}
                </span>
                <span class="finance-drawer-quantity">
                  ×{{ item.quantity.toLocaleString('en-US') }}
                </span>
              </li>
            </ul>
          </EsiResourceBoundary>
        </section>

        <section v-if="contract.type === 'auction'" class="finance-drawer-section">
          <header>
            <span class="finance-drawer-section-label">Bids</span>
            <span class="finance-drawer-section-note">FETCHED ON OPEN</span>
          </header>
          <EsiResourceBoundary
            :state="bidResourceState"
            :has-data="Boolean(bids)"
            @retry="emit('retry-bids')"
          >
            <p v-if="bids && bids.bids.length === 0" class="finance-drawer-empty">
              No bids have been placed on this auction.
            </p>
            <ul v-else-if="bids" class="finance-drawer-list">
              <li v-for="bid in bids.bids" :key="bid.bidId">
                <time :datetime="bid.bidAt" class="is-subtle">{{
                  formatFinanceDate(bid.bidAt)
                }}</time>
                <span class="finance-drawer-quantity">
                  {{ formatFinanceIsk(bid.amount, 0) }} ISK
                </span>
              </li>
            </ul>
            <p class="finance-drawer-footnote">{{ bidPrivacyNote }}</p>
          </EsiResourceBoundary>
        </section>

        <div class="finance-drawer-actions">
          <button class="ui-action-secondary" type="button" @click="emit('show-in-journal')">
            SHOW IN JOURNAL
          </button>
        </div>
      </div>
    </template>
  </UiDrawer>
</template>
