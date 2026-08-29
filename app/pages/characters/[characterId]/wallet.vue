<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import { canRunProtectedQuery } from '../../../queries/query-cache'
import { walletQuery, walletTransactionsQuery } from '../../../queries/wallet'
import { ApiQueryError } from '../../../utils/query-error'
import { parseRouteId } from '../../../utils/route-id'

definePageMeta({ title: 'Character Wallet', layout: 'headerless' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { authSession } = useAuthSession(apiClient)
const transactionsRequested = ref(false)
const characterId = computed(() => parseRouteId(route.params.characterId))
const walletQueryResult = useQuery(() => ({
  ...walletQuery({ apiClient, characterId: characterId.value ?? 0 }),
  enabled: canRunProtectedQuery(
    import.meta.client,
    authSession.value.authenticated,
    characterId.value,
  ),
}))
const wallet = walletQueryResult.data
const transactionQuery = useQuery(() => ({
  ...walletTransactionsQuery({ apiClient, characterId: characterId.value ?? 0 }),
  enabled:
    transactionsRequested.value &&
    canRunProtectedQuery(import.meta.client, authSession.value.authenticated, characterId.value),
}))
const transactions = transactionQuery.data
const walletError = computed(() =>
  walletQueryResult.error.value instanceof ApiQueryError
    ? walletQueryResult.error.value
    : undefined,
)
const walletStatus = computed(() => {
  if (walletQueryResult.data.value) return 'idle'
  if (
    walletError.value?.code === 'EVE_SCOPE_REQUIRED' ||
    walletError.value?.code === 'EVE_REAUTH_REQUIRED'
  ) {
    return 'scope-required'
  }
  if (walletError.value?.status === 404) return 'not-found'
  if (walletQueryResult.status.value === 'error') return 'error'
  if (walletQueryResult.asyncStatus.value === 'loading') return 'loading'
  return 'idle'
})
const walletMessage = computed(() => {
  if (walletError.value?.status === 429 && walletError.value.retryAfterSeconds !== undefined) {
    return `${walletError.value.message} Retry after ${walletError.value.retryAfterSeconds} seconds.`
  }
  return walletQueryResult.error.value instanceof Error
    ? walletQueryResult.error.value.message
    : 'Wallet balance is unavailable.'
})
const formattedWalletBalance = computed(() =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(wallet.value?.balance ?? 0),
)
const transactionError = computed(() =>
  transactionQuery.error.value instanceof ApiQueryError ? transactionQuery.error.value : undefined,
)
const transactionStatus = computed(() => {
  if (transactionQuery.data.value) return 'idle'
  if (transactionQuery.status.value === 'error') return 'error'
  if (transactionQuery.asyncStatus.value === 'loading') return 'loading'
  return 'idle'
})
const transactionMessage = computed(() => {
  if (
    transactionError.value?.status === 429 &&
    transactionError.value.retryAfterSeconds !== undefined
  ) {
    return `${transactionError.value.message} Retry after ${transactionError.value.retryAfterSeconds} seconds.`
  }
  return transactionQuery.error.value instanceof Error
    ? transactionQuery.error.value.message
    : 'Wallet transactions are unavailable.'
})

function loadTransactions(force = false) {
  if (!transactionsRequested.value) {
    transactionsRequested.value = true
    return
  }
  if (force) void transactionQuery.refetch()
}

function refreshBalance() {
  if (walletQueryResult.asyncStatus.value === 'loading') return
  void walletQueryResult.refetch()
}

function formatTransactionDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(value))
}

function formatIsk(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
}

useCharacterReauthorization(characterId, () => {
  void walletQueryResult.refetch()
  if (transactionsRequested.value) void transactionQuery.refetch()
})
</script>

<template>
  <section class="character-wallet-route">
    <UiStatePanel v-if="walletStatus === 'loading' && !wallet" compact role="status">
      <template #icon><div class="app-scanner" aria-hidden="true" /></template>
      <p>Decrypting authorized wallet record...</p>
    </UiStatePanel>
    <CharacterAuthorizationRequired
      v-else-if="walletStatus === 'scope-required'"
      title="Wallet authorization required"
      :message="walletMessage"
      :authorize-url="walletError?.authorizeUrl"
    />
    <UiStatePanel
      v-else-if="walletStatus === 'error' || walletStatus === 'not-found'"
      :code="walletStatus === 'not-found' ? '404' : 'ERR / WALLET'"
      title="Wallet unavailable"
      compact
      role="alert"
      tone="error"
    >
      <p>{{ walletMessage }}</p>
      <template #action>
        <button class="ui-action-secondary" type="button" @click="walletQueryResult.refetch()">
          RETRY UPLINK
        </button>
      </template>
    </UiStatePanel>
    <template v-else-if="wallet">
      <CharacterSummaryCard>
        <template #icon>
          <UiEveImage kind="type-icon" :id="52996" :dimension="42" alt="" aria-hidden="true" />
        </template>
        <template #eyebrow>CHARACTER WALLET</template>
        <template #value>{{ formattedWalletBalance }} ISK</template>
        <template #label>AUTHORIZED BALANCE</template>

        <div class="wallet-summary-actions">
          <span class="private-badge">PRIVATE</span>
          <button
            class="ui-action-secondary"
            type="button"
            :disabled="walletQueryResult.asyncStatus.value === 'loading'"
            @click="refreshBalance"
          >
            {{
              walletQueryResult.asyncStatus.value === 'loading'
                ? 'REFRESHING...'
                : 'REFRESH BALANCE'
            }}
          </button>
        </div>
      </CharacterSummaryCard>

      <section class="wallet-transactions-panel" aria-labelledby="wallet-transactions-title">
        <header>
          <div>
            <span>ON DEMAND</span>
            <h2 id="wallet-transactions-title">Market transactions</h2>
          </div>
          <button
            v-if="!transactionsRequested"
            class="ui-action-secondary"
            type="button"
            @click="loadTransactions()"
          >
            LOAD TRANSACTIONS
          </button>
          <button
            v-else-if="transactions"
            class="ui-action-secondary"
            type="button"
            @click="loadTransactions(true)"
          >
            REFRESH
          </button>
        </header>

        <p v-if="!transactionsRequested" class="wallet-transactions-gate">
          Transaction history is not loaded automatically. Request the latest ESI market activity
          when needed.
        </p>
        <UiStatePanel
          v-else-if="transactionStatus === 'loading' && !transactions"
          compact
          role="status"
        >
          <p>Loading market transaction history...</p>
        </UiStatePanel>
        <UiStatePanel
          v-else-if="transactionStatus === 'error'"
          code="ERR / TRANSACTIONS"
          title="Wallet transactions unavailable"
          compact
          role="alert"
          tone="error"
        >
          <p>{{ transactionMessage }}</p>
          <template #action>
            <a
              v-if="transactionError?.authorizeUrl"
              class="ui-action-primary"
              :href="transactionError.authorizeUrl"
            >
              AUTHORIZE THIS CHARACTER
            </a>
            <button
              v-else
              class="ui-action-secondary"
              type="button"
              @click="loadTransactions(true)"
            >
              RETRY UPLINK
            </button>
          </template>
        </UiStatePanel>
        <UiStatePanel
          v-else-if="transactions?.transactions.length === 0"
          code="NO ACTIVITY"
          title="No recent market activity"
          compact
        >
          <p>This character hasn't bought or sold anything lately.</p>
        </UiStatePanel>
        <ol v-else-if="transactions" class="wallet-transaction-list">
          <li v-for="transaction in transactions.transactions" :key="transaction.transactionId">
            <UiEveImage kind="type-icon" :id="transaction.typeId" :dimension="44" alt="" />
            <div class="wallet-transaction-item">
              <h3>{{ transaction.typeName }}</h3>
              <p>
                <time :datetime="transaction.date">{{
                  formatTransactionDate(transaction.date)
                }}</time>
                <span>QTY {{ transaction.quantity.toLocaleString('en-US') }}</span>
              </p>
            </div>
            <span class="wallet-transaction-side" :class="transaction.isBuy ? 'is-buy' : 'is-sell'">
              {{ transaction.isBuy ? 'BUY' : 'SELL' }}
            </span>
            <div class="wallet-transaction-value">
              <strong :class="transaction.isBuy ? 'is-buy' : 'is-sell'">
                {{ transaction.isBuy ? '-' : '+' }}{{ formatIsk(transaction.totalPrice) }} ISK
              </strong>
              <span>{{ formatIsk(transaction.unitPrice) }} ISK / UNIT</span>
            </div>
          </li>
        </ol>
      </section>
    </template>
  </section>
</template>

<style>
@import url('~/assets/css/features/wallet.css');
@import url('~/assets/css/responsive/wallet.css');
</style>
