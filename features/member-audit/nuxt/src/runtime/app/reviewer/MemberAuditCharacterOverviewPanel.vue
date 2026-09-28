<script setup lang="ts">
import { computed } from 'vue'
import {
  readPlatformApiResponse,
  type PlatformResourceState,
} from '@eve-space/platform-module-nuxt/runtime'
import type { PlatformReviewerPanelProps } from '@eve-space/platform-module-nuxt/runtime/reviewer-panel'
import MemberAuditPanelFrame from './MemberAuditPanelFrame.vue'
import {
  memberAuditReviewerQueryOptions,
  targetLabel,
  withMemberAuditReviewerQueryState,
} from './useMemberAuditReviewerQuery'

const props = defineProps<PlatformReviewerPanelProps>()
const api = usePlatformApi()
const profilePresenter = usePlatformCharacterProfile()
const overview = withMemberAuditReviewerQueryState(
  props,
  usePlatformProtectedQuery(() => ({
    ...memberAuditReviewerQueryOptions(props, async ({ signal }) => {
      if (props.target.kind !== 'managed-organization-character') {
        throw new Error('Select an exact disclosed character for review.')
      }
      return readPlatformApiResponse(
        await api.api.modules['member-audit'].accounts[':userId'].characters[
          ':characterId'
        ].overview.$get(
          { param: { userId: props.target.userId, characterId: String(props.target.characterId) } },
          { init: { signal } },
        ),
        'Public character profile is unavailable.',
      )
    }),
    esiPersistence: { kind: 'none' },
    moduleId: 'member-audit',
    routeId: 'character-overview',
    subject: { kind: 'organization', organizationVersion: props.organizationVersion },
  })),
)
const profile = computed(() => overview.data.value?.profile ?? null)
const profileState = computed<PlatformResourceState>(() => {
  const requestState = overview.requestState.value
  if (requestState.status !== 'ready' || !profile.value?.stale) return requestState
  const failureMessages = {
    'esi-cooldown': 'ESI refresh is on cooldown.',
    'esi-unavailable': 'ESI is unavailable.',
    'response-invalid': 'ESI returned an invalid response.',
    unknown: 'The latest refresh failed.',
  }
  const reason = failureMessages[profile.value.refreshFailureClass ?? 'unknown']
  return {
    status: 'stale',
    title: 'Public profile is stale',
    message: `Showing a stale cached public profile. ${reason} Last validated at ${profile.value.validatedAt}.`,
    retryAt: profile.value.retryAt,
    retryLabel: 'Retry',
  }
})
const state = computed(() => {
  if (overview.requestState.value.status === 'loading') return 'loading' as const
  return overview.requestState.value.status === 'ready' && profile.value
    ? ('ready' as const)
    : ('unavailable' as const)
})
</script>

<template>
  <MemberAuditPanelFrame
    classification="Public profile · read-only review"
    description="Canonical public identity and sanitized biography for the selected character."
    permission="member-audit.summary.read"
    :target="targetLabel(props)"
    title="Character profile"
  >
    <PlatformResourceBoundary
      :state="profileState"
      :has-data="Boolean(profile)"
      @retry="overview.refetch()"
    >
      <component :is="profilePresenter" :profile="profile" :state="state" />
    </PlatformResourceBoundary>
  </MemberAuditPanelFrame>
</template>
