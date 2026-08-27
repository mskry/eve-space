<script setup>
const { navigation: dashboardNavigation } = usePlatformNavigation('dashboard')
const { navigation: characterNavigation } = usePlatformNavigation('character')
</script>

<template>
  <nav data-testid="dashboard-navigation">
    <NuxtLink v-for="entry in dashboardNavigation" :key="entry.navigationId" :to="entry.to">
      {{ entry.label }}
    </NuxtLink>
  </nav>
  <nav data-testid="character-navigation">
    <NuxtLink v-for="entry in characterNavigation" :key="entry.navigationId" :to="entry.to">
      {{ entry.label }}
    </NuxtLink>
  </nav>
  <NuxtPage />
</template>
