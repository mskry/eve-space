<script setup lang="ts">
import type { CharacterClones } from '../../../queries/clones'
import type { JumpCloneCapacity } from '../../../utils/clone-derivation'
import { groupJumpClonesByLocation } from '../../../utils/clone-derivation'

const props = defineProps<{
  jumpClones: CharacterClones['jumpClones']
  capacity: JumpCloneCapacity
}>()

const groups = computed(() => groupJumpClonesByLocation(props.jumpClones))

const summaryLabel = computed(() => {
  const clones = props.jumpClones.length === 1 ? '1 CLONE' : `${props.jumpClones.length} CLONES`
  const locations = groups.value.length === 1 ? '1 LOCATION' : `${groups.value.length} LOCATIONS`
  return `${clones} / ${locations}`
})

const capacityLabel = computed(() =>
  props.capacity.maximum === null
    ? `${props.capacity.installed} JUMP CLONES INSTALLED`
    : `${props.capacity.installed} OF ${props.capacity.maximum} JUMP CLONES INSTALLED`,
)

function groupCountLabel(count: number) {
  return count === 1 ? '1 CLONE' : `${count} CLONES`
}

function implantCountLabel(count: number) {
  return count === 1 ? '1 IMPLANT' : `${count} IMPLANTS`
}
</script>

<template>
  <section class="character-clones-stored" aria-labelledby="character-clones-stored-title">
    <header class="character-clones-section-heading">
      <div>
        <p class="ui-eyebrow">INACTIVE CLONES</p>
        <h2 id="character-clones-stored-title">Jump clones by location</h2>
      </div>
      <span>{{ summaryLabel }}</span>
    </header>

    <div class="character-clones-groups">
      <UiStatePanel
        v-if="jumpClones.length === 0"
        code="NO JUMP CLONES"
        title="No jump clones installed"
        compact
      >
        <p>This character has no jump clones installed.</p>
      </UiStatePanel>

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
            <article class="character-clones-card" :aria-label="clone.name || 'Unnamed jump clone'">
              <UiCollapsible
                v-if="clone.implants.length > 0"
                class="character-clones-card-disclosure"
              >
                <template #trigger>
                  <button
                    class="character-clones-card-summary"
                    type="button"
                    :aria-label="`Toggle implant details for ${clone.name || 'unnamed jump clone'}, ${implantCountLabel(clone.implants.length).toLowerCase()}`"
                  >
                    <img src="/images/eve-clone.png" alt="" width="32" height="32" />
                    <span class="character-clones-card-body">
                      <span class="character-clones-card-name">{{
                        clone.name || 'Unnamed clone'
                      }}</span>
                      <span class="character-clones-card-preview">
                        <UiTooltip
                          v-for="implant in clone.implants"
                          :key="implant.typeId"
                          :content="implant.name"
                          :arrow="false"
                        >
                          <span class="character-clones-card-preview-item">
                            <UiEveImage
                              kind="type-icon"
                              :id="implant.typeId"
                              :dimension="32"
                              alt=""
                            />
                          </span>
                        </UiTooltip>
                        <span
                          v-if="clone.implants.length === 0"
                          class="character-clones-card-preview-empty"
                        >
                          No implants installed
                        </span>
                      </span>
                    </span>
                    <span class="character-clones-card-meta">
                      <span>{{ implantCountLabel(clone.implants.length) }}</span>
                      <svg
                        class="character-clones-card-chevron"
                        viewBox="0 0 24 24"
                        width="16"
                        height="16"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.5"
                        aria-hidden="true"
                      >
                        <path d="m7 9 5 5 5-5" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </span>
                  </button>
                </template>

                <div class="character-clones-card-implants">
                  <CharacterClonesImplantList :implants="clone.implants" />
                </div>
              </UiCollapsible>
              <div
                v-else
                class="character-clones-card-summary character-clones-card-summary--static"
              >
                <img src="/images/eve-clone.png" alt="" width="32" height="32" />
                <span class="character-clones-card-body">
                  <span class="character-clones-card-name">{{
                    clone.name || 'Unnamed clone'
                  }}</span>
                  <span class="character-clones-card-preview-empty">No implants installed</span>
                </span>
              </div>
            </article>
          </li>
        </ol>
      </section>
    </div>

    <p class="character-clones-stored-footer">{{ capacityLabel }}</p>
  </section>
</template>
