<script setup lang="ts">
import { computed } from 'vue'
import { readPlatformApiResponse } from '@eve-space/platform-module-nuxt/runtime'
import type { PlatformReviewerPanelProps } from '@eve-space/platform-module-nuxt/runtime/reviewer-panel'
import MemberAuditEvidencePanel from './MemberAuditEvidencePanel.vue'
import { evidenceNumber, evidenceText } from './evidence-presentation'
import {
  collectionState,
  memberAuditReviewerQueryOptions,
  targetLabel,
  withMemberAuditReviewerQueryState,
} from './useMemberAuditReviewerQuery'

const props = defineProps<PlatformReviewerPanelProps>()
const api = usePlatformApi()
const wallet = withMemberAuditReviewerQueryState(
  props,
  usePlatformProtectedQuery(() => ({
    ...memberAuditReviewerQueryOptions(props, async ({ signal }) => {
      if (props.target.kind !== 'managed-organization-character') {
        throw new Error('Select a disclosed character to review wallet evidence.')
      }
      return readPlatformApiResponse(
        await api.api.modules['member-audit'].accounts[':userId'].characters[
          ':characterId'
        ].wallet.$get(
          {
            param: {
              characterId: String(props.target.characterId),
              userId: props.target.userId,
            },
          },
          { init: { signal } },
        ),
        'Wallet evidence is unavailable.',
      )
    }),
    esiPersistence: { kind: 'none' },
    moduleId: 'member-audit',
    routeId: 'wallet-detail',
    subject: { kind: 'organization', organizationVersion: props.organizationVersion },
  })),
)
const statuses = computed(() =>
  wallet.data.value
    ? [
        wallet.data.value.balance.status,
        wallet.data.value.journal.status,
        wallet.data.value.transactions.status,
      ]
    : [],
)
const state = computed(() => collectionState(statuses.value, wallet.requestState.value))
const hasEvidence = computed(() =>
  Boolean(
    wallet.data.value?.balance.evidence ||
    wallet.data.value?.journal.evidence?.length ||
    wallet.data.value?.transactions.evidence?.length,
  ),
)
</script>

<template>
  <MemberAuditEvidencePanel
    description="Current balance plus bounded journal and transaction records retained for 90 days."
    :has-evidence="hasEvidence"
    permission="member-audit.wallet.read"
    :state="state"
    :statuses="statuses"
    :target="targetLabel(props)"
    title="Wallet"
    @retry="wallet.refetch()"
  >
    <template v-if="wallet.data.value">
      <section>
        <h3>Balance</h3>
        <p v-if="wallet.data.value.balance.evidence">
          {{ evidenceNumber(wallet.data.value.balance.evidence.snapshot.balance) }} ISK
        </p>
        <output v-else>Balance evidence is not currently available.</output>
      </section>
      <section>
        <h3>Journal</h3>
        <p>
          Showing at most the {{ wallet.data.value.previewLimit }} most recent retained journal
          records. Older records may exist.
        </p>
        <output v-if="!wallet.data.value.journal.evidence?.length"
          >No readable journal records.</output
        >
        <ul v-else class="member-audit-evidence-list">
          <li
            v-for="entry in wallet.data.value.journal.evidence"
            :key="String(entry.journalId)"
            class="member-audit-wallet__entry"
          >
            <strong>{{ evidenceText(entry.referenceType, 'Journal entry') }}</strong>
            <span
              >{{ evidenceNumber(entry.amount) }} ISK ·
              {{ evidenceText(entry.date, 'Date unavailable') }}</span
            >
            <span v-if="entry.description">{{ evidenceText(entry.description) }}</span>
            <span v-if="entry.reason">{{ evidenceText(entry.reason) }}</span>
          </li>
        </ul>
      </section>
      <section>
        <h3>Transactions</h3>
        <p>
          Showing at most the {{ wallet.data.value.previewLimit }} most recent retained
          transactions. Older records may exist.
        </p>
        <output v-if="!wallet.data.value.transactions.evidence?.length"
          >No readable transactions.</output
        >
        <ul v-else class="member-audit-evidence-list">
          <li
            v-for="entry in wallet.data.value.transactions.evidence"
            :key="String(entry.transactionId)"
            class="member-audit-wallet__entry"
          >
            <strong>
              <span v-if="entry.isBuy === true">Buy</span>
              <span v-else-if="entry.isBuy === false">Sell</span>
              <span v-else>Direction unavailable</span>
              · {{ evidenceText(entry.typeName, 'Transaction') }}
            </strong>
            <span
              >{{ evidenceNumber(entry.quantity) }} ×
              {{ evidenceNumber(entry.unitPrice) }} ISK</span
            >
            <span
              >{{ evidenceText(entry.date, 'Date unavailable') }} ·
              {{ evidenceText(entry.locationName, 'Location unavailable') }}</span
            >
          </li>
        </ul>
      </section>
    </template>
  </MemberAuditEvidencePanel>
</template>

<style scoped>
.member-audit-wallet__entry {
  display: grid;
  gap: 0.25rem;
  padding: 0.75rem;
  border: 1px solid var(--ui-border);
  background: var(--ui-surface);
  overflow-wrap: anywhere;
}
</style>
