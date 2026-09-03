<script setup lang="ts">
import type { CharacterClones } from '../../../queries/clones'

const props = defineProps<{
  homeLocation: CharacterClones['homeLocation']
  lastStationChangeAt: CharacterClones['lastStationChangeAt']
}>()

const homeLocationLabel = computed(() => {
  const location = props.homeLocation
  if (!location?.locationId || !location.locationType) return 'Home location unavailable'
  if (location.name) return location.name
  return `${location.locationType === 'station' ? 'Station' : 'Structure'} ${location.locationId}`
})

const lastStationChangeLabel = computed(() => historicalDate(props.lastStationChangeAt))

function historicalDate(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return null
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value))
}
</script>

<template>
  <section class="character-clones-home" aria-labelledby="character-clones-home-title">
    <header class="character-clones-section-heading">
      <div>
        <p class="ui-eyebrow">MEDICAL CLONE</p>
        <h2 id="character-clones-home-title">Home location</h2>
      </div>
    </header>

    <dl class="character-clones-home-details">
      <div>
        <dt>Location</dt>
        <dd>{{ homeLocationLabel }}</dd>
      </div>
      <div v-if="lastStationChangeLabel">
        <dt>Last home-station change</dt>
        <dd>
          <time :datetime="lastStationChangeAt ?? undefined">
            {{ lastStationChangeLabel }}
          </time>
        </dd>
      </div>
    </dl>
  </section>
</template>
