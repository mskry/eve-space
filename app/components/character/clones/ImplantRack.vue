<script setup lang="ts">
import type { CharacterImplants } from '../../../queries/clones'
import type { CloneResourceState } from '../../../types/clones'
import type { EsiResourceState } from '../../../types/esi-resource'
import {
  attributeImplantSlotCount,
  implantSlotCount,
  toImplantRack,
} from '../../../utils/clone-derivation'

const props = defineProps<{
  implants?: CharacterImplants
  state: CloneResourceState
}>()

defineEmits<{
  retry: []
}>()

const rack = computed(() => toImplantRack(props.implants?.implants))

const slotSummaryLabel = computed(() => {
  const filled = `${rack.value.filledSlots} / ${implantSlotCount} SLOTS FILLED`
  return rack.value.unslotted.length > 0
    ? `${filled} / ${rack.value.unslotted.length} UNPLACED`
    : filled
})
const resourceState = computed<EsiResourceState>(() => {
  if (props.state.status === 'loading') {
    return { status: 'loading', title: '', message: 'Reading active implant telemetry...' }
  }
  if (props.state.status === 'authorization') {
    return {
      status: 'authorization-required',
      code: 'ESI 403 / IMPLANTS',
      title: 'Active implant authorization required',
      message: props.state.message,
      action: props.state.authorizeUrl
        ? { href: props.state.authorizeUrl, label: 'AUTHORIZE THIS CHARACTER' }
        : null,
    }
  }
  if (props.state.status === 'error') {
    return {
      status: 'error',
      code: 'ERR / IMPLANTS',
      title: 'Active implants unavailable',
      message: props.state.message,
      retryLabel: 'RETRY UPLINK',
    }
  }
  return { status: 'ready' }
})
</script>

<template>
  <section class="character-clones-rack" aria-labelledby="character-clones-rack-title">
    <header class="character-clones-section-heading">
      <div>
        <p class="ui-eyebrow">AUGMENTATIONS</p>
        <h2 id="character-clones-rack-title">Active clone implants</h2>
      </div>
      <span v-if="implants">{{ slotSummaryLabel }}</span>
    </header>

    <EsiResourceBoundary
      :state="resourceState"
      :has-data="Boolean(implants)"
      @retry="$emit('retry')"
    >
      <template v-if="implants">
        <div class="character-clones-rack-columns">
          <div class="character-clones-rack-column">
            <p class="character-clones-rack-group">
              ATTRIBUTE IMPLANTS / SLOTS 1-{{ attributeImplantSlotCount }}
            </p>
            <CharacterClonesImplantSlotList :entries="rack.attributes" />
          </div>
          <div class="character-clones-rack-column">
            <p class="character-clones-rack-group">
              HARDWIRINGS / SLOTS {{ attributeImplantSlotCount + 1 }}-{{ implantSlotCount }}
            </p>
            <CharacterClonesImplantSlotList :entries="rack.hardwirings" />
          </div>
        </div>

        <div v-if="rack.unslotted.length > 0" class="character-clones-rack-unslotted">
          <p class="character-clones-rack-group">SLOT UNKNOWN</p>
          <CharacterClonesImplantList :implants="rack.unslotted" />
        </div>

        <output v-if="implants.stale" class="character-clones-stale">
          STALE SNAPSHOT / Last validated {{ implants.validatedAt }}
        </output>
      </template>
    </EsiResourceBoundary>
  </section>
</template>
