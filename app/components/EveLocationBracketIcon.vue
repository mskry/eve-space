<script setup lang="ts">
import {
  locationBracketIconSource,
  type LocationBracketIdentity,
} from '../utils/location-bracket-icon'

const props = defineProps<LocationBracketIdentity>()

const source = computed(() => locationBracketIconSource(props))
</script>

<template>
  <img
    class="eve-location-bracket-icon"
    :src="source"
    width="16"
    height="16"
    alt=""
    aria-hidden="true"
  />
</template>

<style scoped>
.eve-location-bracket-icon {
  display: block;
  width: 16px;
  height: 16px;
}
</style>
