<script setup lang="ts">
import { computed } from 'vue'
import { readPlatformApiResponse } from '@eve-space/platform-module-nuxt/runtime'
import type { PlatformReviewerPanelProps } from '@eve-space/platform-module-nuxt/runtime/reviewer-panel'
import MemberAuditEvidencePanel from './MemberAuditEvidencePanel.vue'
import { hasMailEvidence } from './evidence-presentation'
import {
  collectionState,
  memberAuditReviewerQueryOptions,
  targetLabel,
  withMemberAuditReviewerQueryState,
} from './useMemberAuditReviewerQuery'

const props = defineProps<PlatformReviewerPanelProps>()
const api = usePlatformApi()
const mail = withMemberAuditReviewerQueryState(
  props,
  usePlatformProtectedQuery(() => ({
    ...memberAuditReviewerQueryOptions(props, async ({ signal }) => {
      if (props.target.kind !== 'managed-organization-character')
        throw new Error('Select a disclosed character to review mail evidence.')
      return readPlatformApiResponse(
        await api.api.modules['member-audit'].accounts[':userId'].characters[
          ':characterId'
        ].mail.$get(
          {
            param: {
              userId: props.target.userId,
              characterId: String(props.target.characterId),
            },
          },
          { init: { signal } },
        ),
        'Mail evidence is unavailable.',
      )
    }),
    esiPersistence: { kind: 'none' },
    moduleId: 'member-audit',
    routeId: 'mail-detail',
    subject: { kind: 'organization', organizationVersion: props.organizationVersion },
  })),
)
const statuses = computed(() =>
  mail.data.value ? [mail.data.value.headers, mail.data.value.details] : [],
)
const state = computed(() => collectionState(statuses.value, mail.requestState.value))
const hasEvidence = computed(() => hasMailEvidence(mail.data.value?.evidence))
</script>

<template>
  <MemberAuditEvidencePanel
    description="Bounded mail headers and sanitized plain-text content retained for 90 days. Raw markup is never shown."
    :evidence="mail.data.value?.evidence ?? null"
    :has-evidence="hasEvidence"
    permission="member-audit.mail.read"
    :state="state"
    :statuses="statuses"
    :target="targetLabel(props)"
    title="Mail"
    @retry="mail.refetch()"
  />
</template>
