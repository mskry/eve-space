<script setup lang="ts">
import type { EsiQueryPersistencePresentation } from '../../query-persistence-presentation.js'

defineProps<{
  presentation: EsiQueryPersistencePresentation
}>()
</script>

<template>
  <output
    v-if="presentation.kind === 'restored-refresh-failed' || presentation.kind === 'server-stale'"
    class="platform-query-persistence"
    :class="`platform-query-persistence--${presentation.kind}`"
    :data-persistence-state="presentation.kind"
    aria-live="polite"
  >
    <template v-if="presentation.kind === 'restored-refresh-failed'">
      <strong>Historical data, refresh failed.</strong>
      Showing a previously loaded browser snapshot. Last current result
      <time :datetime="presentation.originalSuccessAt">{{ presentation.originalSuccessAt }}</time
      >.
      <template v-if="presentation.refreshFailureCode">
        Failure {{ presentation.refreshFailureCode
        }}<template v-if="presentation.refreshFailureStatus">
          (HTTP {{ presentation.refreshFailureStatus }})</template
        >.
      </template>
      <template v-else-if="presentation.refreshFailureStatus">
        Refresh failed with HTTP {{ presentation.refreshFailureStatus }}.
      </template>
      <template v-if="presentation.retryAt">
        Retry no earlier than
        <time :datetime="presentation.retryAt">{{ presentation.retryAt }}</time
        >.
      </template>
    </template>
    <template v-else>
      <strong>Server-stale data.</strong>
      The server returned its last validated ESI representation.
      <template v-if="presentation.validatedAt">
        Validated
        <time :datetime="presentation.validatedAt">{{ presentation.validatedAt }}</time
        >.
      </template>
      <template v-if="presentation.originalSuccessAt">
        Retained from
        <time :datetime="presentation.originalSuccessAt">{{ presentation.originalSuccessAt }}</time
        >.
      </template>
      <template v-if="presentation.refreshFailureClass">
        Refresh failure {{ presentation.refreshFailureClass }}.
      </template>
      <template v-if="presentation.retryAt">
        Retry no earlier than
        <time :datetime="presentation.retryAt">{{ presentation.retryAt }}</time
        >.
      </template>
    </template>
  </output>
</template>

<style scoped>
.platform-query-persistence {
  display: block;
  margin-block: 0.75rem;
  padding: 0.625rem 0.75rem;
  border: 0.0625rem solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-primary) 7%, var(--ui-surface));
  color: var(--ui-text-muted);
  font-size: 0.8125rem;
}

.platform-query-persistence strong {
  color: var(--ui-text);
}

.platform-query-persistence time {
  color: var(--ui-text);
  font-family: var(--ui-font-mono);
}

.platform-query-persistence--restored-refresh-failed,
.platform-query-persistence--server-stale {
  border-color: color-mix(in srgb, var(--ui-warning) 35%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-warning) 7%, var(--ui-surface));
}
</style>
