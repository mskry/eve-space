<script setup lang="ts">
import type { CharacterImplants } from '../../../queries/clones'
import type { ImplantRackEntry } from '../../../utils/clone-derivation'
import { formatAttributeBonus, formatImplantSlot } from '../../../utils/clone-derivation'

type RackImplant = CharacterImplants['implants'][number]

defineProps<{
  entries: ImplantRackEntry<RackImplant>[]
}>()

function bonusLabel(implant: RackImplant) {
  return (implant.bonuses ?? []).map(formatAttributeBonus).join(' ')
}
</script>

<template>
  <ul class="character-clones-slot-list">
    <li v-for="entry in entries" :key="entry.slot">
      <CharacterClonesImplantInformationPopover
        v-if="entry.implant"
        :name="entry.implant.name"
        :type-id="entry.implant.typeId"
      >
        <span class="character-clones-slot-index" aria-hidden="true">
          {{ formatImplantSlot(entry.slot) }}
        </span>
        <UiEveImage kind="type-icon" :id="entry.implant.typeId" :dimension="32" alt="" />
        <span class="character-clones-implant-name">
          <span>{{ entry.implant.name }}</span>
          <AppInformationIcon />
        </span>
        <span v-if="bonusLabel(entry.implant)" class="character-clones-implant-bonus">
          {{ bonusLabel(entry.implant) }}
        </span>
      </CharacterClonesImplantInformationPopover>
      <p v-else class="character-clones-slot-empty">
        <span class="character-clones-slot-index" aria-hidden="true">
          {{ formatImplantSlot(entry.slot) }}
        </span>
        <span>Empty slot</span>
      </p>
    </li>
  </ul>
</template>
