<script setup lang="ts">
import type { VNode } from 'vue'
import type { PlatformResourceState } from '@eve-space/platform-module-nuxt/runtime'
import MemberAuditPanelFrame from './MemberAuditPanelFrame.vue'
import type { MemberAuditCollectionStatus } from './useMemberAuditReviewerQuery'

defineProps<{
  description: string
  hasEvidence: boolean
  permission: string
  state: PlatformResourceState
  statuses: readonly MemberAuditCollectionStatus[]
  target: string
  title: string
}>()

const emit = defineEmits<{ retry: [] }>()
defineSlots<{ default(): VNode[] }>()
</script>

<template>
  <MemberAuditPanelFrame
    classification="Sensitive organization data"
    :description="description"
    :permission="permission"
    :target="target"
    :title="title"
  >
    <ul
      v-if="statuses.length"
      class="member-audit-evidence__statuses"
      aria-label="Collection status"
    >
      <li v-for="status in statuses" :key="status.resourceId">
        <strong>{{ status.resourceId.replaceAll('-', ' ') }}</strong>
        <span>{{ status.status }}</span>
        <span>
          Validated:
          <time v-if="status.validatedAt" :datetime="status.validatedAt">
            {{ status.validatedAt }}
          </time>
          <template v-else>never</template>
        </span>
        <span v-if="status.cachedUntil">
          Upstream expiry: <time :datetime="status.cachedUntil">{{ status.cachedUntil }}</time>
        </span>
      </li>
    </ul>
    <PlatformResourceBoundary
      :state="state"
      :has-data="
        hasEvidence ||
        statuses.some((status) => status.status === 'current' || status.status === 'stale')
      "
      @retry="emit('retry')"
    >
      <output v-if="!hasEvidence" class="member-audit-evidence__empty">
        The current complete observation contains no records.
      </output>
      <slot v-else />
    </PlatformResourceBoundary>
  </MemberAuditPanelFrame>
</template>

<style>
.member-audit-evidence__statuses {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.member-audit-evidence__statuses li {
  display: grid;
  align-content: start;
  min-width: 0;
  gap: 0.25rem;
  padding: 0.75rem;
  border: 1px solid var(--ui-border);
  background: var(--ui-surface);
  overflow-wrap: anywhere;
}

.member-audit-evidence__statuses span {
  color: var(--ui-text-muted);
}

.member-audit-evidence__empty {
  display: block;
  padding: 1rem;
}

.member-audit-evidence-list {
  display: grid;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
