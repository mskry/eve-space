<script setup lang="ts">
import { formatOrganizationReviewDirectoryDate } from '../../utils/organization-review-directory-presentation'

const props = defineProps<{
  timestamp: string | null
}>()

const formatted = computed(() => formatOrganizationReviewDirectoryDate(props.timestamp))
</script>

<template>
  <UiTooltip v-if="formatted.dateTime" :content="formatted.exactLabel ?? formatted.compactLabel">
    <time
      class="organization-review-directory-date"
      :datetime="formatted.dateTime"
      :aria-label="formatted.exactLabel ?? formatted.compactLabel"
    >
      {{ formatted.compactLabel }}
    </time>
  </UiTooltip>
  <span v-else class="organization-review-directory-date is-empty">
    {{ formatted.compactLabel }}
  </span>
</template>

<style scoped>
.organization-review-directory-date {
  display: inline-block;
  max-width: 10rem;
  overflow: hidden;
  color: var(--ui-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.organization-review-directory-date.is-empty {
  color: var(--ui-text-muted);
}
</style>
