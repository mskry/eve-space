<script setup lang="ts">
import { computed } from 'vue'
import { readPlatformApiResponse } from '@eve-space/platform-module-nuxt/runtime'
import type { PlatformReviewerPanelProps } from '@eve-space/platform-module-nuxt/runtime/reviewer-panel'
import MemberAuditEvidencePanel from './MemberAuditEvidencePanel.vue'
import { evidenceNumber } from './evidence-presentation'
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
      if (props.target.kind !== 'managed-organization-character') {
        throw new Error('Select a disclosed character to review trained skills.')
      }
      return readPlatformApiResponse(
        await api.api.modules['member-audit'].accounts[':userId'].characters[
          ':characterId'
        ].skills.$get(
          {
            param: {
              characterId: String(props.target.characterId),
              userId: props.target.userId,
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
const trainedSkills = computed(() => skills.data.value?.trainedSkills)
const evidence = computed(() => trainedSkills.value?.evidence)
const statuses = computed(() => (trainedSkills.value ? [trainedSkills.value.status] : []))
const state = computed(() => collectionState(statuses.value, skills.requestState.value))
const hasEvidence = computed(() =>
  Boolean(evidence.value?.snapshot.groups.some((group) => group.skills.length)),
)
</script>

<template>
  <MemberAuditEvidencePanel
    description="Current trained-skill evidence. The active skill queue is intentionally excluded."
    :has-evidence="hasEvidence"
    permission="member-audit.skills.read"
    :state="state"
    :statuses="statuses"
    :target="targetLabel(props)"
    title="Trained skills"
    @retry="skills.refetch()"
  >
    <template v-if="evidence">
      <p>
        {{ evidenceNumber(evidence.snapshot.totalSp) }} trained skill points across
        {{ evidenceNumber(evidence.snapshot.injectedSkillCount) }} injected skills.
        {{ evidenceNumber(evidence.snapshot.unallocatedSp) }} unallocated skill points.
      </p>
      <section v-for="group in evidence.snapshot.groups" :key="group.groupId ?? group.name">
        <h3>{{ group.name }} · {{ evidenceNumber(group.trainedSp) }} SP</h3>
        <ul class="member-audit-evidence-list">
          <li v-for="skill in group.skills" :key="skill.typeId">
            <strong>{{ skill.name }}</strong>
            · Level {{ skill.trainedLevel }} · {{ evidenceNumber(skill.skillpoints) }} SP
            <span v-if="skill.activeLevel !== skill.trainedLevel">
              (active level {{ skill.activeLevel }})
            </span>
          </li>
        </ul>
      </section>
    </template>
  </MemberAuditEvidencePanel>
</template>
