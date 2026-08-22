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
    <template v-else-if="name === 'corporation'">
      <path d="M3 21V8.5L10 5v16" />
      <path d="M10 10.5 21 7v14" />
      <path d="M6 12h1M6 15.5h1M6 19h1M14 13h1M14 16.5h1M17.5 13h1M17.5 16.5h1" />
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
    <template v-else-if="name === 'settings'">
      <path
        fill="currentColor"
        stroke="none"
        fill-rule="evenodd"
        d="M19.43 12.98c.04-.32.07-.65.07-.98s-.02-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.37-.31-.6-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98L14.5 2.42A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.5.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.08-.48 0-.6.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65c-.04.32-.08.65-.08.98s.03.66.08.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.12.22.37.31.6.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65A.5.5 0 0 0 10 22h4a.5.5 0 0 0 .5-.42l.38-2.65c.61-.25 1.17-.58 1.69-.98l2.49 1c.23.08.48 0 .6-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65ZM12 17A5 5 0 1 1 12 7a5 5 0 0 1 0 10Z"
      />
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
