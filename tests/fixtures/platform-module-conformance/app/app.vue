<script setup lang="ts">
const confirmDialog = providePlatformConfirmDialog()
</script>

<template>
  <NuxtRouteAnnouncer />
  <NuxtAnnouncer />
  <a href="#main-content">Skip to main content</a>
  <section v-if="confirmDialog.dialogOpen.value" role="dialog" aria-modal="true">
    <h2>{{ confirmDialog.title.value }}</h2>
    <p>{{ confirmDialog.description.value }}</p>
    <button type="button" @click="confirmDialog.confirmDialog">
      {{ confirmDialog.confirmLabel.value }}
    </button>
  </section>
  <NuxtPage />
</template>
