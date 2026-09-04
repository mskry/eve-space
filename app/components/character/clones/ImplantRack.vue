<script setup lang="ts">
import type { CharacterImplants } from '../../../queries/clones'
import type { CloneResourceState } from '../../../types/clones'
import {
  attributeImplantSlotCount,
  implantSlotCount,
  toImplantRack,
} from '../../../utils/clone-derivation'
import { toCloneEsiResourceState } from '../../../utils/clone-resource-state'

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
const resourceState = computed(() =>
  toCloneEsiResourceState(props.state, {
    resourceCode: 'IMPLANTS',
    loadingMessage: 'Reading active implant telemetry...',
    authorizationTitle: 'Active implant authorization required',
    errorTitle: 'Active implants unavailable',
  }),
)
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
