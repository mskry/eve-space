<script setup lang="ts">
import type { AssetLocationGroup, AssetVisibleLocation } from '../../types/assets'
import { ASSET_REVEAL_INCREMENT } from '../../utils/assets-controller'

const props = defineProps<{
  containerExpansion: ReadonlySet<number>
  expanded: boolean
  group: AssetLocationGroup
  visible: AssetVisibleLocation
}>()

const emit = defineEmits<{
  itemInformation: [itemId: number]
  toggleContainer: [itemId: number]
  toggleLocation: [key: string]
}>()

const page = ref(1)
const totalPages = computed(() =>
  Math.max(1, Math.ceil(props.visible.rows.length / ASSET_REVEAL_INCREMENT)),
)
const pageRows = computed(() =>
  props.visible.rows.slice(
    (page.value - 1) * ASSET_REVEAL_INCREMENT,
    page.value * ASSET_REVEAL_INCREMENT,
  ),
)
const rowIdentity = computed(() => props.visible.rows.map(({ row }) => row.asset.itemId).join(','))

watch(rowIdentity, () => {
  page.value = Math.min(page.value, totalPages.value)
})

const locationKind = computed(() => {
  if (props.group.placement === 'unresolved-container') return 'NO ACCESS'
  if (props.group.placement === 'broken-cycle') return 'CYCLE RECOVERY'
  if (props.group.locationType === 'solar_system') return 'SOLAR SYSTEM'
  return (props.group.locationType || 'other').replaceAll('_', ' ').toLocaleUpperCase('en')
})
const exceptional = computed(() => props.group.placement !== 'location')
const restricted = computed(() => props.group.placement === 'unresolved-container')
</script>

<template>
  <tbody class="assets-location" :class="{ 'assets-location--open': expanded }">
    <tr class="assets-location-header">
      <th class="assets-location-cell" colspan="7" scope="colgroup">
        <button
          class="assets-location-toggle"
          type="button"
          :aria-expanded="expanded"
          @click="emit('toggleLocation', group.key)"
        >
          <span class="assets-location-chevron" aria-hidden="true">{{ expanded ? '▾' : '▸' }}</span>
          <span class="assets-location-name">{{ group.label }}</span>
          <span class="assets-location-count"
            >{{ group.assetCount.toLocaleString('en-US') }} items</span
          >
          <span
            class="assets-location-kind"
            :class="{ 'assets-location-kind--alert': exceptional }"
            >{{ locationKind }}</span
          >
          <svg
            v-if="restricted"
            class="assets-location-lock"
            viewBox="0 0 14 14"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="3" y="6.25" width="8" height="6" rx="0.75" />
            <path d="M4.75 6.25V4.5a2.25 2.25 0 0 1 4.5 0v1.75" />
          </svg>
        </button>
      </th>
    </tr>

    <template v-if="expanded">
      <AssetsHierarchyRow
        v-for="visibleRow in pageRows"
        :key="visibleRow.row.asset.itemId"
        :expanded="containerExpansion.has(visibleRow.row.asset.itemId)"
        :visible-row="visibleRow"
        @item-information="emit('itemInformation', $event)"
        @toggle="emit('toggleContainer', $event)"
      />
      <tr v-if="totalPages > 1" class="assets-location-footer">
        <td colspan="7">
          <UiPagination
            :current-page="page"
            :label="`${group.label} asset pages`"
            show-pages
            :total-pages="totalPages"
            @change-page="page = $event"
          />
        </td>
      </tr>
    </template>
  </tbody>
</template>

<style scoped>
.assets-location-cell {
  padding: 0;
  border-bottom: 0.0625rem solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-surface-raised) 48%, transparent);
  text-align: left;
}

.assets-location--open .assets-location-cell {
  background: color-mix(in srgb, var(--ui-primary) 7%, var(--ui-surface-raised));
}

.assets-location-toggle {
  width: 100%;
  min-width: 0;
  height: var(--character-compact-row-height);
  padding: 0 0.875rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border: 0;
  color: var(--ui-text);
  background: transparent;
  font: 400 var(--character-data-size) / 1 var(--ui-font-body);
  letter-spacing: 0.01em;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}

.assets-location-toggle:hover {
  background: color-mix(in srgb, var(--ui-primary) 5%, transparent);
}

.assets-location-toggle:focus-visible {
  outline: 0.125rem solid var(--ui-primary);
  outline-offset: -0.125rem;
}

.assets-location-chevron {
  width: 0.75rem;
  flex: 0 0 0.75rem;
  color: var(--ui-text-subtle);
  font: 400 0.56rem/1 var(--ui-font-mono);
}

.assets-location--open .assets-location-chevron {
  color: var(--ui-primary);
}

.assets-location-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.assets-location-count {
  margin-left: auto;
  flex: 0 0 auto;
  color: var(--ui-text-subtle);
}

.assets-location-kind {
  flex: 0 0 auto;
  margin-left: 0.25rem;
  padding: 0.19rem 0.31rem;
  border: 0.0625rem solid var(--ui-border);
  color: var(--ui-text-faint);
  font: 700 0.5rem/1 var(--ui-font-mono);
  letter-spacing: 0.09em;
}

.assets-location-lock {
  width: 0.875rem;
  height: 0.875rem;
  flex: 0 0 auto;
  fill: none;
  stroke: var(--ui-warning);
  stroke-width: 1.1;
  stroke-linecap: round;
}

.assets-location-kind--alert {
  border-color: color-mix(in srgb, var(--ui-warning) 40%, var(--ui-border));
  color: var(--ui-warning);
}

.assets-location-footer > td {
  padding: 0.6rem 0.875rem;
  border-bottom: 0.0625rem solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-surface-solid) 60%, transparent);
}

.assets-location-footer :deep(.ui-pagination) {
  justify-content: flex-end;
}
</style>
