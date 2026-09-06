<script setup lang="ts">
import type { AssetCollection, AssetResourceState } from '../../types/assets'

const props = defineProps<{
  collection: AssetCollection
  state: AssetResourceState
}>()

const emit = defineEmits<{
  authorize: []
  retry: []
}>()

const incompleteEnrichment = computed(() =>
  (
    Object.entries(props.collection.enrichment) as Array<
      [
        keyof AssetCollection['enrichment'],
        AssetCollection['enrichment'][keyof AssetCollection['enrichment']],
      ]
    >
  ).filter(([, status]) => status !== 'complete'),
)

function enrichmentLabel(key: keyof AssetCollection['enrichment']) {
  if (key === 'types') return 'type details'
  if (key === 'names') return 'custom names'
  return 'location names'
}

function formatValidationTime(value: string) {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return 'at an unknown time'
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(time)
}
</script>

<template>
  <output v-if="state.refreshing" class="assets-notice">
    <strong>Refreshing inventory</strong>
    <span>The retained collection remains available while validation completes.</span>
  </output>
  <div
    v-if="state.stale || state.refreshFailed"
    class="assets-notice assets-notice--warning"
    :role="state.refreshFailed ? 'alert' : 'status'"
  >
    <div>
      <strong>{{
        state.refreshFailed ? 'Refresh failed; retained inventory shown' : 'Retained inventory'
      }}</strong>
      <span>
        {{ state.message || 'Live ESI validation is unavailable.' }}
        Validated
        <time :datetime="collection.validatedAt">{{
          formatValidationTime(collection.validatedAt)
        }}</time
        >.
      </span>
    </div>
    <button v-if="state.action" type="button" @click="emit('authorize')">
      {{ state.action.label }}
    </button>
    <button v-else-if="state.canRetry" type="button" @click="emit('retry')">RETRY INVENTORY</button>
  </div>
  <div
    v-if="incompleteEnrichment.length > 0"
    class="assets-notice assets-notice--partial"
    aria-atomic="true"
    aria-live="polite"
  >
    <strong>Inventory context is incomplete</strong>
    <span>
      Deterministic fallbacks are shown for
      {{ incompleteEnrichment.map(([key]) => enrichmentLabel(key)).join(', ') }}.
    </span>
    <ul aria-label="Enrichment status">
      <li v-for="[key, status] in incompleteEnrichment" :key="key">
        {{ enrichmentLabel(key) }}: {{ status }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.assets-notice {
  min-width: 0;
  padding: 0.75rem 1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border: 0.0625rem solid var(--ui-border);
  border-top: 0;
  color: var(--ui-text-muted);
  background: color-mix(in srgb, var(--ui-primary) 5%, var(--ui-surface));
  font-size: 0.75rem;
  overflow-wrap: anywhere;
}

.assets-notice > div,
.assets-notice--partial {
  min-width: 0;
}

.assets-notice strong {
  margin-right: 0.55rem;
  color: var(--ui-text);
  font: 700 0.62rem/1.2 var(--ui-font-mono);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.assets-notice--warning {
  border-color: color-mix(in srgb, var(--ui-warning) 35%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-warning) 7%, var(--ui-surface));
}

.assets-notice--partial {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
}

.assets-notice ul {
  grid-column: 1 / -1;
  margin: 0.25rem 0 0;
  padding-left: 1.25rem;
}

.assets-notice button {
  flex: 0 0 auto;
  min-height: 2.5rem;
  padding: 0.6rem 0.75rem;
  border: 0.0625rem solid var(--ui-warning);
  color: var(--ui-warning);
  background: transparent;
  font: 700 0.55rem/1 var(--ui-font-mono);
  letter-spacing: 0.08em;
}

.assets-notice button:focus-visible {
  outline: 0.125rem solid var(--ui-primary);
  outline-offset: 0.125rem;
}

@media (max-width: 38rem) {
  .assets-notice,
  .assets-notice--partial {
    display: grid;
    grid-template-columns: 1fr;
  }

  .assets-notice button {
    width: 100%;
  }
}
</style>
