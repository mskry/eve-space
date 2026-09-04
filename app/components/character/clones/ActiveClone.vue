<script setup lang="ts">
import type { CharacterClones } from '../../../queries/clones'
import type { CloneResourceState } from '../../../types/clones'
import type { EsiResourceState } from '../../../types/esi-resource'
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
const resourceState = computed<EsiResourceState>(() => {
  if (props.state.status === 'loading') {
    return {
      status: 'loading',
      title: '',
      message: 'Resolving Home Station and jump clone records...',
    }
  }
  if (props.state.status === 'authorization') {
    return {
      status: 'authorization-required',
      code: 'ESI 403 / CLONES',
      title: 'Clone-state authorization required',
      message: props.state.message,
      action: props.state.authorizeUrl
        ? { href: props.state.authorizeUrl, label: 'AUTHORIZE THIS CHARACTER' }
        : null,
    }
  }
  if (props.state.status === 'error') {
    return {
      status: 'error',
      code: 'ERR / CLONES',
      title: 'Clone state unavailable',
      message: props.state.message,
      retryLabel: 'RETRY UPLINK',
    }
  }
  return { status: 'ready' }
})

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

    <EsiResourceBoundary :state="resourceState" :has-data="Boolean(clones)" @retry="$emit('retry')">
      <template v-if="clones">
        <dl v-if="lastCloneJumpLabel" class="character-summary-stats">
          <div>
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
