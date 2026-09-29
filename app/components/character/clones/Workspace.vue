<script setup lang="ts">
import type { CharacterClones } from '../../../queries/clones'
import type {
  CloneImplantCollection,
  CloneResourceState,
  CloneSkillArchive,
} from '../../../types/clones'
import { deriveJumpCloneCapacity } from '../../../utils/clone-derivation'

const props = defineProps<{
  clones?: CharacterClones
  cloneState: CloneResourceState
  implants?: CloneImplantCollection
  implantState: CloneResourceState
  skills?: CloneSkillArchive
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
    <CharacterClonesStoredClones v-if="clones" :jump-clones="clones.jumpClones" />
  </div>
</template>
