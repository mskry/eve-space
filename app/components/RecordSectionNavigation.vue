<script setup lang="ts">
import type { RecordSectionNavigationEntry } from '../types/record-navigation'

const props = defineProps<{
  entries: readonly RecordSectionNavigationEntry[]
  label: string
}>()

const emit = defineEmits<{
  intent: [entry: RecordSectionNavigationEntry]
}>()

const route = useRoute()

function normalizedPath(path: string) {
  return path.length > 1 ? path.replace(/\/$/, '') : path
}

function isCurrent(entry: RecordSectionNavigationEntry) {
  const currentPath = normalizedPath(route.path)
  const targetPath = normalizedPath(entry.to)
  return entry.exact
    ? currentPath === targetPath
    : currentPath === targetPath || currentPath.startsWith(`${targetPath}/`)
}
</script>

<template>
  <nav class="record-section-navigation" :aria-label="label">
    <NuxtLink
      v-for="entry in props.entries"
      :key="entry.id"
      :to="entry.to"
      :class="{ 'is-current': isCurrent(entry) }"
      :aria-current="isCurrent(entry) ? 'page' : undefined"
      prefetch-on="interaction"
      @pointerenter="emit('intent', entry)"
      @focus="emit('intent', entry)"
    >
      {{ entry.label }}
    </NuxtLink>
  </nav>
</template>

<style scoped>
.record-section-navigation {
  width: 100%;
  max-width: 100%;
  margin-bottom: 1.375rem;
  display: flex;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-inline: contain;
  border: 0.0625rem solid var(--ui-border);
  background: var(--ui-surface);
}

.record-section-navigation a {
  position: relative;
  flex: 0 0 auto;
  min-width: 8.25rem;
  padding: 0.9375rem 1.25rem;
  border-right: 0.0625rem solid var(--ui-border);
  color: var(--ui-text-muted);
  font: 700 0.5625rem/1 var(--ui-font-mono);
  letter-spacing: 0.12em;
  text-align: center;
  text-decoration: none;
  white-space: nowrap;
}

.record-section-navigation a::after {
  content: '';
  position: absolute;
  inset: auto 1.125rem -0.0625rem;
  height: 0.125rem;
  background: var(--ui-primary);
  box-shadow: 0 0 0.625rem color-mix(in srgb, var(--ui-primary) 65%, transparent);
  opacity: 0;
}

.record-section-navigation a:hover,
.record-section-navigation a.is-current {
  background: color-mix(in srgb, var(--ui-primary) 7%, transparent);
  color: var(--ui-primary);
}

.record-section-navigation a.is-current::after {
  opacity: 1;
}

.record-section-navigation a:focus-visible {
  z-index: 1;
  outline: 0.125rem solid var(--ui-primary);
  outline-offset: -0.1875rem;
}

@media (max-width: 32.5rem) {
  .record-section-navigation a {
    min-width: max-content;
    padding-inline: 1rem;
  }
}
</style>
