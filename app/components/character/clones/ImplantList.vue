<script setup lang="ts">
import type { CharacterImplants } from '../../../queries/clones'
import { formatImplantSlot } from '../../../utils/clone-derivation'

defineProps<{
  implants: CharacterImplants['implants']
}>()
</script>

<template>
  <ul v-if="implants.length > 0" class="character-clones-implant-list">
    <li v-for="implant in implants" :key="implant.typeId">
      <CharacterClonesImplantInformationPopover :name="implant.name" :type-id="implant.typeId">
        <span class="character-clones-slot-index" aria-hidden="true">
          {{ formatImplantSlot(implant.slot) }}
        </span>
        <UiEveImage kind="type-icon" :id="implant.typeId" :dimension="32" alt="" />
        <span class="character-clones-implant-name">
          <span>{{ implant.name }}</span>
          <AppInformationIcon />
        </span>
      </CharacterClonesImplantInformationPopover>
    </li>
  </ul>
  <p v-else class="character-clones-empty-implants">No implants installed</p>
</template>
