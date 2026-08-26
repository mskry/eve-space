<script setup lang="ts">
import type { CharacterRosterEntry } from '../queries/characters'

defineProps<{
  character: CharacterRosterEntry
}>()

const emit = defineEmits<{
  prefetch: [characterId: number]
}>()

function locationLabel(location: CharacterRosterEntry['location']) {
  if (!location) return '--'
  if (location.stationName) return location.stationName
  if (location.structureId) return `${location.solarSystemName} // Private structure`
  return `${location.solarSystemName} // In space`
}
</script>

<template>
  <article class="roster-card">
    <UiEveImage
      v-if="character.raceFactionId"
      class="roster-race-mark"
      kind="faction"
      :id="character.raceFactionId"
      :dimension="64"
      alt=""
      aria-hidden="true"
    />
    <NuxtLink
      class="roster-card-link"
      :to="`/characters/${character.characterId}`"
      :aria-label="
        character.isMain ? `View ${character.name}, main character` : `View ${character.name}`
      "
      @pointerenter="emit('prefetch', character.characterId)"
      @focus="emit('prefetch', character.characterId)"
    >
      <span class="roster-portrait">
        <UiEveImage
          kind="character"
          :id="character.characterId"
          :dimension="84"
          :alt="`${character.name} character portrait`"
        />
      </span>
      <span class="roster-identity">
        <span class="roster-identity-name">
          <h2>{{ character.name }}</h2>
          <UiMainCharacterMark v-if="character.isMain" variant="icon" />
        </span>
        <span class="roster-org">
          <UiTooltip :content="character.corporation.name" :arrow="false">
            <UiEveImage
              kind="corporation"
              :id="character.corporation.id"
              :dimension="42"
              :alt="`${character.corporation.name} corporation logo`"
            />
          </UiTooltip>
          <UiTooltip v-if="character.alliance" :content="character.alliance.name" :arrow="false">
            <UiEveImage
              kind="alliance"
              :id="character.alliance.id"
              :dimension="34"
              :alt="`${character.alliance.name} alliance logo`"
            />
          </UiTooltip>
        </span>
      </span>
    </NuxtLink>
    <div class="roster-stats">
      <span v-if="typeof character.securityStatus === 'number'" class="roster-stat">
        <SecurityStatus :value="character.securityStatus" />
      </span>
      <span class="roster-stat">
        <span class="sr-only">Location:</span>
        <span class="roster-location-icon" aria-hidden="true">
          <AppIcon name="location" />
        </span>
        <span class="roster-stat-value" :title="locationLabel(character.location)">
          {{ locationLabel(character.location) }}
        </span>
      </span>
      <span class="roster-stat">
        <span class="sr-only">Ship:</span>
        <span class="roster-ship-icon" aria-hidden="true">
          <AppIcon name="ship" />
        </span>
        <span class="roster-stat-value" :title="character.ship ? character.ship.name : undefined">
          {{ character.ship?.typeName ?? '--' }}
        </span>
      </span>
      <span class="roster-value-stats">
        <span class="roster-stat">
          {{
            typeof character.totalSp === 'number' ? formatCompactAmount(character.totalSp) : '--'
          }}
          <span class="roster-stat-key">SP</span>
        </span>
        <span class="roster-value-separator" aria-hidden="true">•</span>
        <span class="roster-stat">
          {{
            typeof character.walletBalance === 'number'
              ? formatCompactAmount(character.walletBalance)
              : '--'
          }}
          <span class="roster-stat-key">ISK</span>
        </span>
      </span>
    </div>
  </article>
</template>
