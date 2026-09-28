<script setup lang="ts">
import type { PlatformCharacterProfileProps } from '@eve-space/platform-module-nuxt/runtime'

defineProps<PlatformCharacterProfileProps>()
</script>

<template>
  <section data-testid="fixture-character-profile">
    <output v-if="state !== 'ready'">{{ state }}</output>
    <p v-else>{{ profile?.name }}</p>
  </section>
</template>
