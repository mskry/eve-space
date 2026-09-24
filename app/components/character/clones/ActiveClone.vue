<script setup lang="ts">
import type { EsiQueryPersistencePresentation } from '@eve-space/platform-module-nuxt/runtime'
import type { CharacterClones } from '../../../queries/clones'
import type { CloneResourceState } from '../../../types/clones'
import { jumpCloneLocationLabel, type JumpCloneCapacity } from '../../../utils/clone-derivation'
import { toCloneEsiResourceState } from '../../../utils/clone-resource-state'

const props = defineProps<{
  clones?: CharacterClones
  capacity: JumpCloneCapacity
  presentation?: EsiQueryPersistencePresentation
  state: CloneResourceState
}>()

defineEmits<{
  retry: []
}>()

const capacityValue = computed(() =>
  props.capacity.maximum === null
    ? `${props.capacity.installed} INSTALLED`
    : `${props.capacity.installed} OF ${props.capacity.maximum} INSTALLED`,
)

const capacityLabel = computed(() => {
  if (props.capacity.maximum === null) {
    return 'CAPACITY UNKNOWN'
  }
  const available = props.capacity.maximum - props.capacity.installed
  if (available === 0) {
    return 'CAPACITY REACHED'
  }
  return `${available} ${available === 1 ? 'SLOT' : 'SLOTS'} AVAILABLE`
})

const lastCloneJumpLabel = computed(() => historicalDate(props.clones?.lastCloneJumpAt))
const lastStationChangeLabel = computed(() => historicalDate(props.clones?.lastStationChangeAt))
const homeLocationLabel = computed(() => {
  const location = props.clones?.homeLocation
  if (!location?.locationId || !location.locationType) {
    return 'Home Station unavailable'
  }
  return jumpCloneLocationLabel({
    locationId: location.locationId,
    locationType: location.locationType,
    name: location.name,
  })
})

const capacityNote = computed(() =>
  props.capacity.maximum === null ? 'Maximum needs the skills resource for this character.' : '',
)
const resourceState = computed(() =>
  toCloneEsiResourceState(props.state, {
    authorizationTitle: 'Clone-state authorization required',
    errorTitle: 'Clone state unavailable',
    loadingMessage: 'Resolving Home Station and jump clone records...',
    resourceCode: 'CLONES',
  }),
)

function historicalDate(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) {
    return null
  }
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value))
}
</script>

<template>
  <AppSummaryCard class="character-clones-active" role="region" aria-label="Jump clones">
    <template #icon>
      <UiEveImage kind="type-icon" :id="165" :dimension="40" alt="" aria-hidden="true" />
    </template>
    <template #eyebrow>JUMP CLONES</template>
    <template #value>{{ clones ? capacityValue : '--' }}</template>
    <template #label>{{ clones ? capacityLabel : 'CAPACITY UNAVAILABLE' }}</template>

    <EsiResourceBoundary
      :state="resourceState"
      :has-data="Boolean(clones)"
      :presentation="presentation"
      @retry="$emit('retry')"
    >
      <template v-if="clones">
        <dl class="character-summary-stats">
          <div>
            <dt>HOME STATION</dt>
            <dd class="character-clones-home-location">
              <SystemSecurityStatus
                v-if="typeof clones.homeLocation?.solarSystemSecurityStatus === 'number'"
                :value="clones.homeLocation.solarSystemSecurityStatus"
              />
              <span>{{ homeLocationLabel }}</span>
            </dd>
          </div>
          <div v-if="lastStationChangeLabel">
            <dt>LAST HOME STATION CHANGE</dt>
            <dd>
              <time :datetime="clones.lastStationChangeAt ?? undefined">
                {{ lastStationChangeLabel }}
              </time>
            </dd>
          </div>
          <div v-if="lastCloneJumpLabel">
            <dt>LAST CLONE JUMP</dt>
            <dd>
              <time :datetime="clones.lastCloneJumpAt ?? undefined">
                {{ lastCloneJumpLabel }}
              </time>
            </dd>
          </div>
        </dl>

        <p v-if="capacityNote" class="character-clones-vital-note">{{ capacityNote }}</p>

        <output v-if="clones.stale" class="character-clones-stale">
          STALE SNAPSHOT / Last validated {{ clones.validatedAt }}
        </output>
      </template>
    </EsiResourceBoundary>
  </AppSummaryCard>
</template>
