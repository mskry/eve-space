<script setup lang="ts">
const { navigation: dashboardNavigation } = usePlatformNavigation('dashboard')
const { navigation: characterNavigation } = usePlatformNavigation('character')
const confirmDialog = providePlatformConfirmDialog()
</script>

<template>
  <NuxtAnnouncer />
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
  <section v-if="confirmDialog.dialogOpen.value" role="dialog" aria-modal="true">
    <h2>{{ confirmDialog.title.value }}</h2>
    <p>{{ confirmDialog.description.value }}</p>
    <button type="button" @click="confirmDialog.confirmDialog">
      {{ confirmDialog.confirmLabel.value }}
    </button>
  </section>
  <NuxtPage />
</template>
