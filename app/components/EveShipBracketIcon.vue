<script setup lang="ts">
import { shipBracketIconSource } from '../utils/ship-bracket-icon'

const { groupId = null } = defineProps<{
  groupId?: number | null
}>()

const source = computed(() => shipBracketIconSource(groupId))
</script>

<template>
  <img
    class="eve-ship-bracket-icon"
    :src="source"
    width="16"
    height="16"
    alt=""
    aria-hidden="true"
  />
</template>

<style scoped>
.eve-ship-bracket-icon {
  display: block;
  width: 16px;
  height: 16px;
}
</style>
