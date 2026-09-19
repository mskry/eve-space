<script setup lang="ts">
import type { EsiQueryPersistencePresentation } from '@eve-space/platform-module-nuxt/runtime'
import type { CharacterSkills } from '../../../queries/characters'
import type { CharacterClones, CharacterImplants } from '../../../queries/clones'
import type { CloneResourceState } from '../../../types/clones'
import { deriveJumpCloneCapacity } from '../../../utils/clone-derivation'

const props = defineProps<{
  clones?: CharacterClones
  cloneState: CloneResourceState
  clonesPresentation?: EsiQueryPersistencePresentation
  implants?: CharacterImplants
  implantState: CloneResourceState
  implantsPresentation?: EsiQueryPersistencePresentation
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
      :presentation="clonesPresentation"
      :state="cloneState"
      @retry="$emit('retryClones')"
    />
    <CharacterClonesImplantRack
      :implants="implants"
      :state="implantState"
      :presentation="implantsPresentation"
      @retry="$emit('retryImplants')"
    />
    <CharacterClonesStoredClones v-if="clones" :jump-clones="clones.jumpClones" />
  </div>
</template>
