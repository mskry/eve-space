<script setup lang="ts">
import type { CharacterClones } from '../../../queries/clones'
import type { CloneResourceState } from '../../../types/clones'
import type { JumpCloneCapacity } from '../../../utils/clone-derivation'

const props = defineProps<{
  clones?: CharacterClones
  capacity: JumpCloneCapacity
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
  if (props.capacity.maximum === null) return 'CAPACITY UNKNOWN'
  const available = props.capacity.maximum - props.capacity.installed
  if (available === 0) return 'CAPACITY REACHED'
  return `${available} ${available === 1 ? 'SLOT' : 'SLOTS'} AVAILABLE`
})

const lastCloneJumpLabel = computed(() => historicalDate(props.clones?.lastCloneJumpAt))

const capacityNote = computed(() =>
  props.capacity.maximum === null ? 'Maximum needs the skills resource for this character.' : '',
)

function historicalDate(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return null
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

    <div class="character-clones-active-content">
      <UiStatePanel v-if="state.status === 'loading'" compact role="status">
        <template #icon><div class="app-scanner" aria-hidden="true" /></template>
        <p>Resolving Home Station and jump clone records...</p>
      </UiStatePanel>
      <CharacterAuthorizationRequired
        v-else-if="state.status === 'authorization'"
        title="Clone-state authorization required"
        :message="state.message"
        :authorize-url="state.authorizeUrl"
        compact
      />
      <UiStatePanel
        v-else-if="state.status === 'error'"
        code="ERR / CLONES"
        title="Clone state unavailable"
        compact
        role="alert"
        tone="error"
      >
        <p>{{ state.message }}</p>
        <template #action>
          <button class="ui-action-secondary" type="button" @click="$emit('retry')">
            RETRY UPLINK
          </button>
        </template>
      </UiStatePanel>
      <template v-else-if="clones">
        <div v-if="lastCloneJumpLabel" class="character-clones-jump-status">
          <p class="character-clones-vital-label">LAST CLONE JUMP</p>
          <p class="character-clones-activity-value">
            <time :datetime="clones.lastCloneJumpAt ?? undefined">
              {{ lastCloneJumpLabel }}
            </time>
          </p>
        </div>

        <p v-if="capacityNote" class="character-clones-vital-note">{{ capacityNote }}</p>

        <output v-if="clones.stale" class="character-clones-stale">
          STALE SNAPSHOT / Last validated {{ clones.validatedAt }}
        </output>
      </template>
    </div>
  </AppSummaryCard>
</template>
