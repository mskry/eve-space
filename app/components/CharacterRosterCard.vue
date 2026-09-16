<script setup lang="ts">
import type { CharacterRosterEntry } from '../queries/characters'
import {
  characterNameViewTransitionName,
  characterPortraitViewTransitionName,
} from '../utils/view-transition'

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
      :width="64"
      :height="64"
      loading="lazy"
      decoding="async"
      alt=""
      aria-hidden="true"
    />
    <NuxtLink
      class="roster-card-link"
      :to="`/characters/${character.characterId}`"
      view-transition
      :aria-label="
        character.isMain ? `View ${character.name}, main character` : `View ${character.name}`
      "
      @pointerenter="emit('prefetch', character.characterId)"
      @focus="emit('prefetch', character.characterId)"
    >
      <span
        class="roster-portrait"
        :style="{
          viewTransitionName: characterPortraitViewTransitionName(character.characterId),
        }"
      >
        <UiEveImage
          kind="character"
          :id="character.characterId"
          :dimension="84"
          :width="84"
          :height="84"
          loading="lazy"
          decoding="async"
          :alt="`${character.name} character portrait`"
        />
      </span>
      <span class="roster-identity">
        <span class="roster-identity-name">
          <h2
            :style="{
              viewTransitionName: characterNameViewTransitionName(character.characterId),
            }"
          >
            {{ character.name }}
          </h2>
          <UiMainCharacterMark v-if="character.isMain" variant="icon" />
        </span>
        <span class="roster-org">
          <UiTooltip :content="character.corporation.name" :arrow="false">
            <UiEveImage
              kind="corporation"
              :id="character.corporation.id"
              :dimension="50"
              :width="50"
              :height="50"
              loading="lazy"
              decoding="async"
              :alt="`${character.corporation.name} corporation logo`"
            />
          </UiTooltip>
          <UiTooltip v-if="character.alliance" :content="character.alliance.name" :arrow="false">
            <UiEveImage
              kind="alliance"
              :id="character.alliance.id"
              :dimension="34"
              :width="34"
              :height="34"
              loading="lazy"
              decoding="async"
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
        <SystemSecurityStatus
          v-if="typeof character.location?.solarSystemSecurityStatus === 'number'"
          :value="character.location.solarSystemSecurityStatus"
        />
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
