<script setup lang="ts">
import type { CloneImplantCollection } from '../../../types/clones'
import { formatImplantSlot, implantBonusLabel } from '../../../utils/clone-derivation'

defineProps<{
  implants: CloneImplantCollection['implants']
}>()
</script>

<template>
  <ul v-if="implants.length > 0" class="character-clones-implant-list">
    <li v-for="implant in implants" :key="implant.typeId">
      <CharacterClonesImplantInformationPopover :name="implant.name" :type-id="implant.typeId">
        <span class="character-clones-slot-index" aria-hidden="true">
          {{ formatImplantSlot(implant.slot) }}
        </span>
        <UiEveImage
          kind="type-icon"
          :id="implant.typeId"
          :dimension="32"
          :width="32"
          :height="32"
          loading="lazy"
          decoding="async"
          alt=""
        />
        <span class="character-clones-implant-name">
          <span>{{ implant.name }}</span>
          <AppInformationIcon />
        </span>
        <span v-if="implantBonusLabel(implant)" class="character-clones-implant-bonus">
          {{ implantBonusLabel(implant) }}
        </span>
      </CharacterClonesImplantInformationPopover>
    </li>
  </ul>
  <p v-else class="character-clones-empty-implants">No implants installed</p>
</template>
