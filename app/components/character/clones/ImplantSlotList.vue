<script setup lang="ts">
import type { CharacterImplants } from '../../../queries/clones'
import type { ImplantRackEntry } from '../../../utils/clone-derivation'
import { formatImplantSlot, implantBonusLabel } from '../../../utils/clone-derivation'

type RackImplant = CharacterImplants['implants'][number]
type FilledRackEntry = ImplantRackEntry<RackImplant> & { implant: RackImplant }

const props = defineProps<{
  entries: ImplantRackEntry<RackImplant>[]
}>()

const filledEntries = computed(() =>
  props.entries.filter((entry): entry is FilledRackEntry => entry.implant !== null),
)
</script>

<template>
  <ul class="character-clones-slot-list">
    <li v-for="entry in filledEntries" :key="entry.slot">
      <CharacterClonesImplantInformationPopover
        :name="entry.implant.name"
        :type-id="entry.implant.typeId"
      >
        <span class="character-clones-slot-index" aria-hidden="true">
          {{ formatImplantSlot(entry.slot) }}
        </span>
        <UiEveImage
          kind="type-icon"
          :id="entry.implant.typeId"
          :dimension="32"
          :width="32"
          :height="32"
          loading="lazy"
          decoding="async"
          alt=""
        />
        <span class="character-clones-implant-name">
          <span>{{ entry.implant.name }}</span>
          <AppInformationIcon />
        </span>
        <span v-if="implantBonusLabel(entry.implant)" class="character-clones-implant-bonus">
          {{ implantBonusLabel(entry.implant) }}
        </span>
      </CharacterClonesImplantInformationPopover>
    </li>
  </ul>
</template>
