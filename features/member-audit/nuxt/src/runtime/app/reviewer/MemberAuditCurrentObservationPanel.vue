<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { readPlatformApiResponse } from '@eve-space/platform-module-nuxt/runtime'
import type { PlatformReviewerPanelProps } from '@eve-space/platform-module-nuxt/runtime/reviewer-panel'
import MemberAuditEvidencePanel from './MemberAuditEvidencePanel.vue'
import { observationDeadline, observationDisplayStatus } from './observation-state'
import {
  collectionState,
  memberAuditReviewerQueryOptions,
  targetLabel,
  withMemberAuditReviewerQueryState,
} from './useMemberAuditReviewerQuery'

const props = defineProps<PlatformReviewerPanelProps>()
const api = usePlatformApi()
const observation = withMemberAuditReviewerQueryState(
  props,
  usePlatformProtectedQuery(() => ({
    ...memberAuditReviewerQueryOptions(props, async ({ signal }) => {
      if (props.target.kind !== 'managed-organization-character') {
        throw new Error('Select an exact disclosed character for current observations.')
      }
      return readPlatformApiResponse(
        await api.api.modules['member-audit'].accounts[':userId'].characters[':characterId'][
          'current-observation'
        ].$get(
          { param: { userId: props.target.userId, characterId: String(props.target.characterId) } },
          { init: { signal } },
        ),
        'Current observation evidence is unavailable.',
      )
    }),
    esiPersistence: { kind: 'none' },
    moduleId: 'member-audit',
    routeId: 'current-observation-detail',
    subject: { kind: 'organization', organizationVersion: props.organizationVersion },
  })),
)
const now = ref<number | null>(null)
const ship = computed(() => observation.data.value?.currentShip)
const location = computed(() => observation.data.value?.currentLocation)
const shipStatus = computed(() => {
  const status = ship.value?.status
  if (!status) return []
  const current = observationDisplayStatus(status, now.value)
  return [
    {
      ...status,
      status: current === 'current' && !ship.value?.evidence ? ('unavailable' as const) : current,
    },
  ]
})
const locationStatus = computed(() => {
  const status = location.value?.status
  if (!status) return []
  const current = observationDisplayStatus(status, now.value)
  return [
    {
      ...status,
      status:
        current === 'current' && !location.value?.evidence ? ('unavailable' as const) : current,
    },
  ]
})
const shipState = computed(() => collectionState(shipStatus.value, observation.requestState.value))
const locationState = computed(() =>
  collectionState(locationStatus.value, observation.requestState.value),
)
const shipEvidence = computed(() =>
  shipStatus.value[0]?.status === 'current' ? ship.value?.evidence?.snapshot : null,
)
const locationEvidence = computed(() =>
  locationStatus.value[0]?.status === 'current' ? location.value?.evidence?.snapshot : null,
)

let deadlineTimer: ReturnType<typeof setTimeout> | undefined
let stopDeadlineWatch: (() => void) | undefined
const scheduleDeadline = () => {
  clearTimeout(deadlineTimer)
  const timestamp = Date.now()
  now.value = timestamp
  const future = [ship.value?.status, location.value?.status]
    .flatMap((status) => (status ? [observationDeadline(status)] : []))
    .filter((deadline): deadline is number => deadline !== null && deadline > timestamp)
  if (future.length > 0) {
    const next = Math.min(...future)
    deadlineTimer = setTimeout(
      scheduleDeadline,
      Math.max(1, Math.min(next - timestamp, 2_147_483_647)),
    )
  }
}

onMounted(() => {
  stopDeadlineWatch = watch(() => observation.data.value, scheduleDeadline, { immediate: true })
})
onBeforeUnmount(() => {
  stopDeadlineWatch?.()
  clearTimeout(deadlineTimer)
})
</script>

<template>
  <div class="member-audit-current-observation">
    <MemberAuditEvidencePanel
      description="Latest validated ship type and name, without ship instance identity."
      :has-evidence="Boolean(shipEvidence)"
      permission="member-audit.current-observation.read"
      :state="shipState"
      :statuses="shipStatus"
      :target="targetLabel(props)"
      title="Current ship"
      @retry="observation.refetch()"
    >
      <p v-if="shipEvidence">
        {{ shipEvidence.name || 'Unnamed ship' }} · {{ shipEvidence.typeName }} ({{
          shipEvidence.groupName
        }})
      </p>
    </MemberAuditEvidencePanel>
    <MemberAuditEvidencePanel
      description="Latest solar system and station or structure identity, without movement history."
      :has-evidence="Boolean(locationEvidence)"
      permission="member-audit.current-observation.read"
      :state="locationState"
      :statuses="locationStatus"
      :target="targetLabel(props)"
      title="Current location"
      @retry="observation.refetch()"
    >
      <p v-if="locationEvidence">
        {{ locationEvidence.solarSystemName }} · {{ locationEvidence.locationType }}
        <template v-if="locationEvidence.stationId">· {{ locationEvidence.stationName }}</template>
        <template v-if="locationEvidence.structureId"
          >· Structure {{ locationEvidence.structureId }}</template
        >
      </p>
    </MemberAuditEvidencePanel>
  </div>
</template>

<style scoped>
.member-audit-current-observation {
  display: grid;
  gap: 1rem;
  min-width: 0;
}
</style>
