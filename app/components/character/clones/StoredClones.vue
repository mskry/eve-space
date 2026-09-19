<script setup lang="ts">
import type { CharacterClones } from '../../../queries/clones'
import { groupJumpClonesByLocation } from '../../../utils/clone-derivation'

type JumpClone = CharacterClones['jumpClones'][number]

const props = defineProps<{
  jumpClones: CharacterClones['jumpClones']
}>()

const groups = computed(() => groupJumpClonesByLocation(props.jumpClones))

const summaryLabel = computed(() => {
  const clones = props.jumpClones.length === 1 ? '1 CLONE' : `${props.jumpClones.length} CLONES`
  const locations = groups.value.length === 1 ? '1 LOCATION' : `${groups.value.length} LOCATIONS`
  return `${clones} / ${locations}`
})

function groupCountLabel(count: number) {
  return count === 1 ? '1 CLONE' : `${count} CLONES`
}

// Unnamed clones number among themselves, so the visible labels run 1..n without holes.
function cloneDisplayName(clone: JumpClone, group: JumpClone[]) {
  if (clone.name) return clone.name
  const unnamed = group.filter((entry) => !entry.name)
  if (unnamed.length === 1) return 'Unnamed clone'
  return `Clone ${unnamed.indexOf(clone) + 1} of ${unnamed.length}`
}
</script>

<template>
  <section class="character-clones-stored" aria-labelledby="character-clones-stored-title">
    <UiCollapsible>
      <template #trigger>
        <button class="character-clones-section-heading" type="button">
          <span id="character-clones-stored-title" class="character-clones-section-title">
            Jump clones by location
          </span>
          <span class="character-clones-section-summary">
            {{ summaryLabel }}
            <span class="character-clones-section-toggle" aria-hidden="true" />
          </span>
        </button>
      </template>

      <div class="character-clones-groups">
        <p v-if="jumpClones.length === 0" class="character-clones-empty">None installed</p>

        <section v-for="group in groups" :key="group.key" class="character-clones-group">
          <header class="character-clones-group-heading" :data-location-type="group.locationType">
            <h3>{{ group.label }}</h3>
            <span>
              {{ group.locationType === 'station' ? 'STATION' : 'STRUCTURE' }} /
              {{ groupCountLabel(group.clones.length) }}
            </span>
          </header>
          <ol class="character-clones-group-list">
            <li v-for="clone in group.clones" :key="clone.jumpCloneId">
              <article
                class="character-clones-card"
                :class="{ 'character-clones-card--empty': clone.implants.length === 0 }"
                :aria-label="cloneDisplayName(clone, group.clones)"
              >
                <img
                  src="/images/eve-clone.png"
                  alt=""
                  width="32"
                  height="32"
                  loading="lazy"
                  decoding="async"
                />
                <span class="character-clones-card-name">
                  {{ cloneDisplayName(clone, group.clones) }}
                </span>
                <CharacterClonesImplantList :implants="clone.implants" />
              </article>
            </li>
          </ol>
        </section>
      </div>
    </UiCollapsible>
  </section>
</template>
