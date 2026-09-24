<script setup lang="ts">
import { computed } from 'vue'
import { readPlatformApiResponse } from '@eve-space/platform-module-nuxt/runtime'
import type { PlatformReviewerPanelProps } from '@eve-space/platform-module-nuxt/runtime/reviewer-panel'
import MemberAuditEvidencePanel from './MemberAuditEvidencePanel.vue'
import { hasWalletEvidence } from './evidence-presentation'
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
    ? [wallet.data.value.balance, wallet.data.value.journal, wallet.data.value.transactions]
    : [],
)
const state = computed(() => collectionState(statuses.value, wallet.requestState.value))
const hasEvidence = computed(() => hasWalletEvidence(wallet.data.value?.evidence))
</script>

<template>
  <MemberAuditEvidencePanel
    description="Current balance plus bounded journal and transaction records retained for 90 days."
    :evidence="wallet.data.value?.evidence ?? null"
    :has-evidence="hasEvidence"
    permission="member-audit.wallet.read"
    :state="state"
    :statuses="statuses"
    :target="targetLabel(props)"
    title="Wallet"
    @retry="wallet.refetch()"
  />
</template>
