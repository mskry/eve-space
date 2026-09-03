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
          <svg
            class="character-clones-implant-action"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11.25v4.5" stroke-linecap="round" />
            <path d="M12 8.25h.01" stroke-linecap="round" />
          </svg>
        </span>
      </CharacterClonesImplantInformationPopover>
    </li>
  </ul>
  <p v-else class="character-clones-empty-implants">No implants installed.</p>
</template>
