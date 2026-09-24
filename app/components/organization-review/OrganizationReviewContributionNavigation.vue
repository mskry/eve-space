<script setup lang="ts">
import type { PlatformReviewerPanelCatalogEntry } from '@eve-space/platform-module-nuxt/runtime'
import { reviewerContributionIdentity } from '../../utils/organization-review'

const props = defineProps<{
  contributions: readonly PlatformReviewerPanelCatalogEntry[]
  modelValue?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const tabs = computed(() =>
  props.contributions.map((contribution) => ({
    contribution,
    label: contribution.label,
    value: reviewerContributionIdentity(contribution),
  })),
)
</script>

<template>
  <section class="organization-review-contributions" aria-labelledby="review-contributions-heading">
    <header>
      <p class="ui-eyebrow">REVIEW CAPABILITIES</p>
      <h2 id="review-contributions-heading">Available panels</h2>
    </header>
    <div
      v-if="!props.modelValue"
      class="organization-review-contributions__choices"
      aria-label="Available review panels"
    >
      <button
        v-for="tab in tabs"
        :key="tab.value"
        type="button"
        @click="emit('update:modelValue', tab.value)"
      >
        {{ tab.label }}
      </button>
    </div>
    <UiTabs
      v-else
      :model-value="props.modelValue"
      :tabs="tabs"
      aria-label="Available review panels"
      content-class="organization-review-contributions__content"
      list-class="organization-review-contributions__tabs"
      :unmount-on-hide="true"
      @update:model-value="$event && emit('update:modelValue', $event)"
    >
      <template #trigger="slotProps">
        <span>{{ slotProps?.tab.label }}</span>
      </template>
      <template v-for="tab in tabs" :key="tab.value" #[tab.value]>
        <slot v-if="tab.value === props.modelValue" />
      </template>
    </UiTabs>
    <p v-if="!props.modelValue" class="organization-review-contributions__prompt">
      Select a permitted panel to load its private data.
    </p>
  </section>
</template>

<style scoped>
.organization-review-contributions {
  min-width: 0;
  padding: clamp(1rem, 2vw, 1.5rem);
  border: 1px solid var(--ui-border);
  background: var(--ui-surface-raised);
  overflow: hidden;
}

.organization-review-contributions h2 {
  margin: 0.25rem 0 1rem;
}

.organization-review-contributions__prompt {
  margin: 1rem 0 0;
  color: var(--ui-text-muted);
}

.organization-review-contributions__choices {
  display: flex;
  max-width: 100%;
  gap: 0.5rem;
  overflow-x: auto;
}

.organization-review-contributions__choices button {
  flex: 0 0 auto;
  min-height: 2.75rem;
  padding: 0.625rem 0.875rem;
  border: 1px solid var(--ui-border);
  background: var(--ui-surface);
  color: var(--ui-text);
}

.organization-review-contributions__choices button:focus-visible {
  outline: var(--ui-focus-ring-width) solid var(--ui-focus-ring);
  outline-offset: 2px;
}

.organization-review-contributions :deep(.organization-review-contributions__tabs) {
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: thin;
}

.organization-review-contributions :deep(.ui-tabs-trigger:focus-visible) {
  outline: var(--ui-focus-ring-width) solid var(--ui-focus-ring);
  outline-offset: -2px;
}

.organization-review-contributions :deep(.organization-review-contributions__content) {
  min-width: 0;
  padding-top: 1rem;
}
</style>
