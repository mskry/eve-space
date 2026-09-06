<script setup lang="ts">
import type { CharacterSkills } from '../../../queries/characters'
import type { CharacterClones, CharacterImplants } from '../../../queries/clones'
import type { CloneResourceState } from '../../../types/clones'
import { deriveJumpCloneCapacity } from '../../../utils/clone-derivation'

const props = defineProps<{
  clones?: CharacterClones
  cloneState: CloneResourceState
  implants?: CharacterImplants
  implantState: CloneResourceState
  skills?: CharacterSkills
}>()

defineEmits<{
  retryClones: []
  retryImplants: []
}>()

const capacity = computed(() =>
  deriveJumpCloneCapacity(props.clones?.jumpClones.length ?? 0, props.skills),
)
</script>

<template>
  <div class="character-clones-workspace">
    <CharacterClonesActiveClone
      :clones="clones"
      :capacity="capacity"
      :state="cloneState"
      @retry="$emit('retryClones')"
    />
    <CharacterClonesImplantRack
      :implants="implants"
      :state="implantState"
      @retry="$emit('retryImplants')"
    />
    <CharacterClonesHomeLocation
      v-if="clones"
      :home-location="clones.homeLocation"
      :last-station-change-at="clones.lastStationChangeAt"
    />
    <CharacterClonesStoredClones
      v-if="clones"
      :jump-clones="clones.jumpClones"
      :capacity="capacity"
    />
  </div>
</template>
