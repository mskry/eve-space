<script setup lang="ts">
import { computed } from 'vue'
import { readPlatformApiResponse } from '@eve-space/platform-module-nuxt/runtime'
import type { PlatformReviewerPanelProps } from '@eve-space/platform-module-nuxt/runtime/reviewer-panel'
import MemberAuditEvidencePanel from './MemberAuditEvidencePanel.vue'
import { hasTrainedSkillsEvidence } from './evidence-presentation'
import {
  collectionState,
  memberAuditReviewerQueryOptions,
  targetLabel,
  withMemberAuditReviewerQueryState,
} from './useMemberAuditReviewerQuery'

const props = defineProps<PlatformReviewerPanelProps>()
const api = usePlatformApi()
const skills = withMemberAuditReviewerQueryState(
  props,
  usePlatformProtectedQuery(() => ({
    ...memberAuditReviewerQueryOptions(props, async ({ signal }) => {
      if (props.target.kind !== 'managed-organization-character')
        throw new Error('Select a disclosed character to review trained skills.')
      return readPlatformApiResponse(
        await api.api.modules['member-audit'].accounts[':userId'].characters[
          ':characterId'
        ].skills.$get(
          {
            param: {
              userId: props.target.userId,
              characterId: String(props.target.characterId),
            },
          },
          { init: { signal } },
        ),
        'Trained-skill evidence is unavailable.',
      )
    }),
    esiPersistence: { kind: 'none' },
    moduleId: 'member-audit',
    routeId: 'skills-detail',
    subject: { kind: 'organization', organizationVersion: props.organizationVersion },
  })),
)
const statuses = computed(() => (skills.data.value ? [skills.data.value.trainedSkills] : []))
const state = computed(() => collectionState(statuses.value, skills.requestState.value))
const hasEvidence = computed(() => hasTrainedSkillsEvidence(skills.data.value?.evidence))
</script>

<template>
  <MemberAuditEvidencePanel
    description="Current trained-skill evidence. The active skill queue is intentionally excluded."
    :evidence="skills.data.value?.evidence ?? null"
    :has-evidence="hasEvidence"
    permission="member-audit.skills.read"
    :state="state"
    :statuses="statuses"
    :target="targetLabel(props)"
    title="Trained skills"
    @retry="skills.refetch()"
  />
</template>
