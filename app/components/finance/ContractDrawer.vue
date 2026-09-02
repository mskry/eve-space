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
          <UiStatePanel v-if="itemState.loading && !items" compact role="status">
            <p>Loading contract items...</p>
          </UiStatePanel>
          <UiStatePanel
            v-else-if="itemState.errorMessage && !items"
            code="ERR / ITEMS"
            title="Contract items unavailable"
            compact
            role="alert"
            tone="error"
          >
            <p>{{ itemState.errorMessage }}</p>
            <template
              v-if="
                itemState.authorizationAction ||
                itemState.canRetry ||
                itemState.authorizationRequired
              "
              #action
            >
              <a
                v-if="itemState.authorizationAction"
                class="ui-action-primary"
                :href="itemState.authorizationAction.href"
              >
                {{ itemState.authorizationAction.label }}
              </a>
              <button v-else class="ui-action-secondary" type="button" @click="emit('retry-items')">
                RETRY
              </button>
            </template>
          </UiStatePanel>
          <p v-else-if="items && items.items.length === 0" class="finance-drawer-empty">
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
        </section>

        <section v-if="contract.type === 'auction'" class="finance-drawer-section">
          <header>
            <span class="finance-drawer-section-label">Bids</span>
            <span class="finance-drawer-section-note">FETCHED ON OPEN</span>
          </header>
          <UiStatePanel v-if="bidState.loading && !bids" compact role="status">
            <p>Loading auction bids...</p>
          </UiStatePanel>
          <UiStatePanel
            v-else-if="bidState.errorMessage && !bids"
            code="ERR / BIDS"
            title="Auction bids unavailable"
            compact
            role="alert"
            tone="error"
          >
            <p>{{ bidState.errorMessage }}</p>
            <template
              v-if="
                bidState.authorizationAction || bidState.canRetry || bidState.authorizationRequired
              "
              #action
            >
              <a
                v-if="bidState.authorizationAction"
                class="ui-action-primary"
                :href="bidState.authorizationAction.href"
              >
                {{ bidState.authorizationAction.label }}
              </a>
              <button v-else class="ui-action-secondary" type="button" @click="emit('retry-bids')">
                RETRY
              </button>
            </template>
          </UiStatePanel>
          <p v-else-if="bids && bids.bids.length === 0" class="finance-drawer-empty">
            No bids have been placed on this auction.
          </p>
          <ul v-else-if="bids" class="finance-drawer-list">
            <li v-for="bid in bids.bids" :key="bid.bidId">
              <time :datetime="bid.bidAt" class="is-subtle">{{
                formatFinanceDate(bid.bidAt)
              }}</time>
              <span class="finance-drawer-quantity">{{ formatFinanceIsk(bid.amount, 0) }} ISK</span>
            </li>
          </ul>
          <p class="finance-drawer-footnote">{{ bidPrivacyNote }}</p>
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
