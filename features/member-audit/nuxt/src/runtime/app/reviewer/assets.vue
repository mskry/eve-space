<script setup lang="ts">
import { computed } from 'vue'
import { readPlatformApiResponse } from '@eve-space/platform-module-nuxt/runtime'
import type { PlatformReviewerPanelProps } from '@eve-space/platform-module-nuxt/runtime/reviewer-panel'
import MemberAuditEvidencePanel from './MemberAuditEvidencePanel.vue'
import { hasAssetEvidence } from './evidence-presentation'
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
      if (props.target.kind !== 'managed-organization-character')
        throw new Error('Select a disclosed character to review assets.')
      return readPlatformApiResponse(
        await api.api.modules['member-audit'].accounts[':userId'].characters[
          ':characterId'
        ].assets.$get(
          {
            param: {
              userId: props.target.userId,
              characterId: String(props.target.characterId),
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
const statuses = computed(() => (assets.data.value ? [assets.data.value.status] : []))
const state = computed(() => collectionState(statuses.value, assets.requestState.value))
const hasEvidence = computed(() => hasAssetEvidence(assets.data.value?.evidence))
</script>

<template>
  <MemberAuditEvidencePanel
    description="The current complete asset observation, including bounded type and location labels."
    :evidence="assets.data.value?.evidence ?? null"
    :has-evidence="hasEvidence"
    permission="member-audit.assets.read"
    :state="state"
    :statuses="statuses"
    :target="targetLabel(props)"
    title="Assets"
    @retry="assets.refetch()"
  />
</template>
