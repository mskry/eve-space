<script setup lang="ts">
import { providePlatformCharacterProfile } from '@eve-space/platform-module-nuxt/runtime'
import FixtureCharacterProfile from './components/FixtureCharacterProfile.vue'

providePlatformCharacterProfile(FixtureCharacterProfile)
</script>

<template>
  <NuxtPage />
</template>
