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
const assets = withMemberAuditReviewerQueryState(
  props,
  usePlatformProtectedQuery(() => ({
    ...memberAuditReviewerQueryOptions(props, async ({ signal }) => {
      if (props.target.kind !== 'managed-organization-character') {
        throw new Error('Select a disclosed character to review assets.')
      }
      return readPlatformApiResponse(
        await api.api.modules['member-audit'].accounts[':userId'].characters[
          ':characterId'
        ].assets.$get(
          {
            param: {
              characterId: String(props.target.characterId),
              userId: props.target.userId,
            },
          },
          { init: { signal } },
        ),
        'Asset evidence is unavailable.',
      )
    }),
    esiPersistence: { kind: 'none' },
    moduleId: 'member-audit',
    routeId: 'assets-detail',
    subject: { kind: 'organization', organizationVersion: props.organizationVersion },
  })),
)
const evidence = computed(() => assets.data.value?.assets.evidence)
const statuses = computed(() => (assets.data.value ? [assets.data.value.assets.status] : []))
const state = computed(() => collectionState(statuses.value, assets.requestState.value))
const hasEvidence = computed(() => Boolean(evidence.value?.snapshot.records.length))
</script>

<template>
  <MemberAuditEvidencePanel
    description="The current complete asset observation, including bounded type and location labels."
    :has-evidence="hasEvidence"
    permission="member-audit.assets.read"
    :state="state"
    :statuses="statuses"
    :target="targetLabel(props)"
    title="Assets"
    @retry="assets.refetch()"
  >
    <template v-if="evidence">
      <p>
        {{ evidenceNumber(evidence.snapshot.records.length) }} assets in the complete observation.
      </p>
      <ul class="member-audit-evidence-list">
        <li
          v-for="asset in evidence.snapshot.records"
          :key="String(asset.itemId)"
          class="member-audit-asset"
        >
          <strong>{{
            evidenceText(asset.customName, evidenceText(asset.typeName, 'Unknown asset'))
          }}</strong>
          <span
            >{{ evidenceNumber(asset.quantity) }} ×
            {{ evidenceText(asset.typeName, 'Unknown type') }}</span
          >
          <span
            >Location:
            {{
              evidenceText(asset.locationName, `Location ${evidenceNumber(asset.locationId)}`)
            }}</span
          >
          <span v-if="typeof asset.totalVolume === 'number'"
            >Volume: {{ evidenceNumber(asset.totalVolume) }} m³</span
          >
        </li>
      </ul>
    </template>
  </MemberAuditEvidencePanel>
</template>

<style scoped>
.member-audit-asset {
  display: grid;
  gap: 0.25rem;
  padding: 0.75rem;
  border: 1px solid var(--ui-border);
  background: var(--ui-surface);
  overflow-wrap: anywhere;
}
</style>
