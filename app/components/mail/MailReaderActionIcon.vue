<script setup lang="ts">
defineProps<{
  name: 'reply' | 'reply-all' | 'forward' | 'labels' | 'mark-read' | 'mark-unread' | 'delete'
}>()
</script>

<template>
  <svg
    class="mail-reader-action-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'reply'">
      <path d="m9 7-5 5 5 5" />
      <path d="M5 12h7a7 7 0 0 1 7 7" />
    </template>
    <template v-else-if="name === 'reply-all'">
      <path d="m8 7-5 5 5 5" />
      <path d="m12 7-5 5 5 5" />
      <path d="M8 12h5a7 7 0 0 1 7 7" />
    </template>
    <template v-else-if="name === 'forward'">
      <path d="m15 7 5 5-5 5" />
      <path d="M19 12h-7a7 7 0 0 0-7 7" />
    </template>
    <template v-else-if="name === 'labels'">
      <path d="m20 13-7 7-9-9V4h7l9 9Z" />
      <circle cx="8" cy="8" r="1.25" />
    </template>
    <template v-else-if="name === 'mark-read'">
      <rect x="3" y="5" width="18" height="14" rx="1" />
      <path d="m3 7 9 7 9-7" />
      <path d="m16 17 1.5 1.5L21 15" />
    </template>
    <template v-else-if="name === 'mark-unread'">
      <rect x="3" y="5" width="18" height="14" rx="1" />
      <path d="m3 7 9 7 9-7" />
      <circle cx="19" cy="6" r="2.25" fill="currentColor" stroke="none" />
    </template>
    <template v-else>
      <path d="M4 7h16" />
      <path d="m9 3h6l1 4H8l1-4Z" />
      <path d="m6 7 1 14h10l1-14" />
      <path d="M10 11v6M14 11v6" />
    </template>
  </svg>
</template>
