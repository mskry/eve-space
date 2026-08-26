<script setup lang="ts">
const emit = defineEmits<{
  attach: []
}>()
</script>

<template>
  <button class="roster-card roster-add-card" type="button" @click="emit('attach')">
    <span class="roster-ghost-top" aria-hidden="true">
      <span class="roster-ghost-portrait" />
      <span class="roster-ghost-identity">
        <span class="roster-ghost-line roster-ghost-line--name" />
        <span class="roster-ghost-org">
          <span class="roster-ghost-badge" />
        </span>
      </span>
    </span>
    <span class="roster-ghost-stats" aria-hidden="true">
      <span class="roster-ghost-line roster-ghost-line--stat-short" />
      <span class="roster-ghost-line roster-ghost-line--stat" />
      <span class="roster-ghost-line roster-ghost-line--stat-mid" />
      <span class="roster-ghost-value-stats">
        <span class="roster-ghost-line" />
        <span class="roster-ghost-separator">•</span>
        <span class="roster-ghost-line" />
      </span>
    </span>
    <span class="roster-add-overlay">
      <span class="add-character-icon" aria-hidden="true">+</span>
      ADD CHARACTER
    </span>
  </button>
</template>
