<script setup lang="ts">
import type { PlatformReviewerDirectoryRow } from '@eve-space/platform-module-contract/reviewer-directory'
import { organizationReviewDirectoryGroupOverflow } from '../../utils/organization-review-directory-presentation'

const props = defineProps<{
  groups: PlatformReviewerDirectoryRow['groups']
}>()

const overflow = computed(() => organizationReviewDirectoryGroupOverflow(props.groups))
</script>

<template>
  <span v-if="groups.length === 0" class="organization-review-directory-groups__empty">
    No groups
  </span>
  <div v-else class="organization-review-directory-groups">
    <span
      v-for="group in overflow.visibleGroups"
      :key="group.groupId"
      class="organization-review-directory-groups__badge"
    >
      {{ group.name }}
    </span>
    <UiPopover v-if="overflow.remainingCount > 0" align="end" close-label="Close current groups">
      <template #trigger>
        <button
          class="organization-review-directory-groups__more"
          type="button"
          :aria-label="`Show all ${groups.length} current groups`"
        >
          +{{ overflow.remainingCount }}
        </button>
      </template>
      <section class="organization-review-directory-groups__popover" aria-label="Current groups">
        <strong>Current groups</strong>
        <ul>
          <li v-for="group in groups" :key="group.groupId">{{ group.name }}</li>
        </ul>
      </section>
    </UiPopover>
  </div>
</template>

<style scoped>
.organization-review-directory-groups {
  display: flex;
  max-width: 14rem;
  gap: 0.3rem;
  align-items: center;
}

.organization-review-directory-groups__badge,
.organization-review-directory-groups__more {
  max-width: 6.5rem;
  padding: 0.2rem 0.4rem;
  border: 1px solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-primary) 7%, var(--ui-surface));
  color: var(--ui-text);
  font: 500 0.72rem/1.2 var(--ui-font-body);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.organization-review-directory-groups__more {
  flex: 0 0 auto;
  border-color: var(--ui-border-strong);
  color: var(--ui-primary);
  cursor: pointer;
}

.organization-review-directory-groups__more:focus-visible {
  outline: var(--ui-focus-ring-width) solid var(--ui-focus-ring);
  outline-offset: 2px;
}

.organization-review-directory-groups__empty {
  color: var(--ui-text-muted);
  white-space: nowrap;
}

.organization-review-directory-groups__popover {
  min-width: 12rem;
  padding: 0.25rem;
}

.organization-review-directory-groups__popover strong {
  color: var(--ui-text);
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.organization-review-directory-groups__popover ul {
  display: grid;
  gap: 0.4rem;
  padding: 0;
  margin: 0.75rem 0 0;
  color: var(--ui-text-muted);
  list-style: none;
}
</style>
