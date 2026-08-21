<script setup lang="ts">
import type { DashboardIcon } from '../utils/dashboard-sections'

defineProps<{
  name: DashboardIcon
}>()
</script>

<template>
  <svg class="app-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <template v-if="name === 'overview'">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </template>
    <template v-else-if="name === 'character'">
      <circle cx="9" cy="12" r="4.5" />
      <path d="M14 9.5h5l-2.5 6.5" />
    </template>
    <template v-else-if="name === 'wallet'">
      <path d="M3 6.5h15a3 3 0 0 1 3 3v8.5H5a2 2 0 0 1-2-2V6.5Z" />
      <path d="M3 7V5a2 2 0 0 1 2-2h12" />
      <path d="M16 11h5v4h-5a2 2 0 0 1 0-4Z" />
    </template>
    <template v-else-if="name === 'location'">
      <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </template>
    <template v-else-if="name === 'ship'">
      <path d="M12 2c3 2.5 5 6 5 10v5l-5 3-5-3v-5c0-4 2-7.5 5-10Z" />
      <circle cx="12" cy="10" r="2" />
      <path d="m7 14-4 3v3l5-2M17 14l4 3v3l-5-2" />
    </template>
    <template v-else-if="name === 'integrations'">
      <path d="M8 3v5H3" />
      <path d="M16 21v-5h5" />
      <path d="M3 8a8 8 0 0 1 13.7-3.7L20 8" />
      <path d="M21 16a8 8 0 0 1-13.7 3.7L4 16" />
    </template>
    <template v-else-if="name === 'admin'">
      <path d="M12 2.5 20 6v5.5c0 4.8-3.2 8.1-8 10-4.8-1.9-8-5.2-8-10V6l8-3.5Z" />
      <circle cx="12" cy="10" r="2.25" />
      <path d="M8.5 17c.6-2 1.8-3 3.5-3s2.9 1 3.5 3" />
    </template>
    <template v-else>
      <path d="M7 10V7a5 5 0 0 1 10 0v3" />
      <rect x="4" y="10" width="16" height="11" />
      <path d="M12 14v3" />
    </template>
  </svg>
</template>
