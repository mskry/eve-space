<script setup lang="ts">
import type {
  AssetCollection,
  AssetFilterState,
  AssetHierarchyRow,
  AssetRecord,
  AssetResourceAction,
  AssetResourceState,
} from '../../types/assets'
import { createAssetWorkspaceController } from '../../utils/assets-controller'
import {
  EMPTY_ASSET_FILTERS,
  filterAssetHierarchy,
  hasActiveAssetFilters,
} from '../../utils/assets-filter'
import { buildAssetHierarchy } from '../../utils/assets-hierarchy'

type AssetSortKey =
  | 'item'
  | 'quantity'
  | 'group'
  | 'category'
  | 'placement'
  | 'totalVolume'
  | 'unitVolume'

const props = defineProps<{
  collection: AssetCollection | null
  state: AssetResourceState
}>()

const emit = defineEmits<{
  authorize: [action: AssetResourceAction]
  itemInformation: [itemId: number]
  retry: []
}>()

const columns: { key: AssetSortKey; label: string; numeric?: boolean }[] = [
  { key: 'item', label: 'Name' },
  { key: 'quantity', label: 'Quantity', numeric: true },
  { key: 'group', label: 'Group' },
  { key: 'category', label: 'Category' },
  { key: 'placement', label: 'Placement' },
  { key: 'totalVolume', label: 'Volume', numeric: true },
  { key: 'unitVolume', label: 'Unit vol.', numeric: true },
]
const sortOptions = columns.map((column) => ({ value: column.key, label: column.label }))
const identityProperties = {
  type: { id: 'typeId', label: 'typeName' },
  group: { id: 'groupId', label: 'groupName' },
  category: { id: 'categoryId', label: 'categoryName' },
} as const

const filters = ref<AssetFilterState>({ ...EMPTY_ASSET_FILTERS })
const controller = shallowRef(createAssetWorkspaceController())
const sortKey = ref<AssetSortKey>('item')
const sortDescending = ref(false)
const hierarchy = computed(() => buildAssetHierarchy(props.collection?.assets ?? []))
const filtered = computed(() => filterAssetHierarchy(hierarchy.value, filters.value))
const activeFilters = computed(() => hasActiveAssetFilters(filters.value))
const containerExpansion = computed<ReadonlySet<number>>(() => {
  return new Set(
    props.collection?.assets
      .filter((asset) => activeFilters.value || controller.value.isContainerExpanded(asset.itemId))
      .map((asset) => asset.itemId) ?? [],
  )
})
const knownVolume = computed(() =>
  (props.collection?.assets ?? []).reduce(
    (sum, asset) =>
      asset.totalVolume !== null && Number.isFinite(asset.totalVolume) && asset.totalVolume >= 0
        ? sum + asset.totalVolume
        : sum,
    0,
  ),
)
const typeOptions = computed(() => optionsByIdentity(props.collection?.assets ?? [], 'type'))
const groupOptions = computed(() => optionsByIdentity(props.collection?.assets ?? [], 'group'))
const categoryOptions = computed(() =>
  optionsByIdentity(props.collection?.assets ?? [], 'category'),
)
const locationOptions = computed(() =>
  hierarchy.value.map((group) => ({ value: group.key, label: group.label })),
)
const flagOptions = computed(() =>
  [...new Set((props.collection?.assets ?? []).map((asset) => asset.locationFlag))]
    .toSorted((left, right) => left.localeCompare(right, 'en'))
    .map((flag) => ({ value: flag, label: flag || 'Unknown flag' })),
)
const sortModel = computed<string>({
  get: () => sortKey.value,
  set: (value) => {
    sortKey.value = value as AssetSortKey
    sortDescending.value = false
  },
})

watch(
  hierarchy,
  (groups) => {
    controller.value.sync(groups)
    triggerRef(controller)
  },
  { immediate: true },
)

watch(
  filters,
  (value) => {
    if (controller.value.setCriteria(value)) triggerRef(controller)
  },
  { deep: true },
)

function changeFilters(value: AssetFilterState) {
  filters.value = value
}

function isLocationExpanded(key: string) {
  return activeFilters.value || controller.value.isLocationExpanded(key)
}

function visibleLocation(group: (typeof filtered.value.groups)[number]) {
  // Sort the tree, not the flattened list: flat sorting detaches children from their container.
  const rows = controller.value.rowsForLocation({ ...group, rows: sortHierarchy(group.rows) })
  return { rows, totalVisibleRows: rows.length, hasMore: false }
}

function sortHierarchy(rows: readonly AssetHierarchyRow[]): AssetHierarchyRow[] {
  return rows
    .map((row) =>
      row.children.length > 0 ? { ...row, children: sortHierarchy(row.children) } : row,
    )
    .toSorted(compareRows)
}

function toggleLocation(key: string) {
  controller.value.toggleLocation(key)
  triggerRef(controller)
}

function toggleContainer(itemId: number) {
  controller.value.toggleContainer(itemId)
  triggerRef(controller)
}

function toggleSort(key: AssetSortKey) {
  if (sortKey.value === key) sortDescending.value = !sortDescending.value
  else {
    sortKey.value = key
    sortDescending.value = false
  }
}

function sortIndicator(key: AssetSortKey) {
  if (sortKey.value !== key) return '<>'
  return sortDescending.value ? 'v' : '^'
}

function ariaSort(key: AssetSortKey): 'ascending' | 'descending' | undefined {
  if (sortKey.value !== key) return undefined
  return sortDescending.value ? 'descending' : 'ascending'
}

function authorize() {
  if (props.state.action) emit('authorize', props.state.action)
}

function compareRows(left: AssetHierarchyRow, right: AssetHierarchyRow) {
  const leftValue = sortValue(left)
  const rightValue = sortValue(right)
  let order: number
  if (leftValue === null && rightValue === null) order = left.asset.itemId - right.asset.itemId
  else if (leftValue === null) order = 1
  else if (rightValue === null) order = -1
  else
    order =
      typeof leftValue === 'number' && typeof rightValue === 'number'
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue), 'en')
  const resolved = order || left.asset.itemId - right.asset.itemId
  return sortDescending.value ? -resolved : resolved
}

function sortValue(row: AssetHierarchyRow) {
  const asset = row.asset
  if (sortKey.value === 'item') return asset.customName?.trim() || asset.typeName
  if (sortKey.value === 'quantity') return asset.quantity
  if (sortKey.value === 'group') return asset.groupName
  if (sortKey.value === 'category') return asset.categoryName
  if (sortKey.value === 'placement') return asset.locationFlag
  if (sortKey.value === 'totalVolume') return asset.totalVolume
  return asset.unitVolume
}

function optionsByIdentity(assets: readonly AssetRecord[], kind: 'type' | 'group' | 'category') {
  const options = new Map<number, string>()
  const properties = identityProperties[kind]
  for (const asset of assets) {
    const id = asset[properties.id]
    const label = asset[properties.label]
    if (id !== null && label !== null && !options.has(id)) options.set(id, label)
  }
  return [...options]
    .map(([value, label]) => ({ value, label }))
    .toSorted(
      (left, right) => left.label.localeCompare(right.label, 'en') || left.value - right.value,
    )
}
</script>

<template>
  <div class="assets-workspace">
    <AssetsResourceState
      v-if="!collection"
      :state="state"
      @authorize="authorize"
      @retry="emit('retry')"
    />

    <template v-else>
      <AssetsSummary
        :asset-count="collection.assets.length"
        :known-volume="knownVolume"
        :location-count="hierarchy.length"
      />
      <AssetsNotices
        :collection="collection"
        :state="state"
        @authorize="authorize"
        @retry="emit('retry')"
      />

      <template v-if="collection.assets.length > 0">
        <AssetsToolbar
          v-model:sort="sortModel"
          :category-options="categoryOptions"
          :filters="filters"
          :flag-options="flagOptions"
          :group-options="groupOptions"
          :location-options="locationOptions"
          :match-count="filtered.matchCount"
          :sort-options="sortOptions"
          :source-count="filtered.sourceCount"
          :type-options="typeOptions"
          @change="changeFilters"
        />

        <section class="assets-results" aria-labelledby="assets-results-title">
          <h2 id="assets-results-title" class="sr-only">Inventory by location</h2>

          <UiStatePanel
            v-if="filtered.groups.length === 0"
            class="assets-filtered-empty"
            compact
            role="status"
            title="No inventory matches"
          >
            <p>Change the search or filters to restore the complete inventory view.</p>
          </UiStatePanel>

          <UiScrollArea v-else class="assets-table-scroll" horizontal>
            <table class="assets-manifest">
              <caption class="sr-only">
                Personal inventory grouped by location
              </caption>
              <colgroup>
                <col class="assets-column-item" />
                <col class="assets-column-quantity" />
                <col class="assets-column-group" />
                <col class="assets-column-category" />
                <col class="assets-column-placement" />
                <col class="assets-column-volume" />
                <col class="assets-column-volume" />
              </colgroup>
              <thead>
                <tr>
                  <th
                    v-for="column in columns"
                    :key="column.key"
                    :class="{ 'assets-manifest-number': column.numeric }"
                    scope="col"
                    :aria-sort="ariaSort(column.key)"
                  >
                    <button type="button" @click="toggleSort(column.key)">
                      {{ column.label }}
                      <span aria-hidden="true">{{ sortIndicator(column.key) }}</span>
                    </button>
                  </th>
                </tr>
              </thead>

              <AssetsLocationSection
                v-for="group in filtered.groups"
                :key="group.key"
                :container-expansion="containerExpansion"
                :expanded="isLocationExpanded(group.key)"
                :group="group"
                :visible="visibleLocation(group)"
                @item-information="emit('itemInformation', $event)"
                @toggle-container="toggleContainer"
                @toggle-location="toggleLocation"
              />
            </table>
          </UiScrollArea>
        </section>
      </template>

      <UiStatePanel
        v-else
        class="assets-empty"
        compact
        role="status"
        title="Personal inventory empty"
      >
        <p>No personal assets were returned in the complete collection.</p>
      </UiStatePanel>
    </template>
  </div>
</template>

<style scoped>
.assets-workspace {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  display: grid;
  overflow: clip;
}

.assets-workspace :deep(.character-summary-card + *) {
  margin-top: var(--character-summary-gap);
  border-top: 0.0625rem solid var(--ui-border);
}

.assets-results {
  min-width: 0;
  display: grid;
}

.assets-table-scroll {
  min-width: 0;
  width: 100%;
  border: 0.0625rem solid var(--ui-border);
  border-top: 0;
  background: var(--ui-surface);
}

.assets-manifest {
  width: 100%;
  min-width: 66rem;
  border-collapse: collapse;
  table-layout: fixed;
}

.assets-column-item {
  width: auto;
}

.assets-column-quantity {
  width: 5.5rem;
}

.assets-column-group {
  width: 11rem;
}

.assets-column-category {
  width: 8.25rem;
}

.assets-column-placement {
  width: 7.63rem;
}

.assets-column-volume {
  width: 8.5rem;
}

.assets-manifest thead th {
  height: 1.75rem;
  padding: 0 0.75rem;
  border-bottom: 0.0625rem solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-surface-raised) 74%, transparent);
  color: var(--ui-text-faint);
  font: 700 0.5rem/1 var(--ui-font-mono);
  letter-spacing: 0.09em;
  text-align: left;
  text-transform: uppercase;
  white-space: nowrap;
}

.assets-manifest thead th.assets-manifest-number > button {
  width: 100%;
  justify-content: flex-end;
}

.assets-manifest thead th > button {
  padding: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.31rem;
  border: 0;
  outline: none;
  background: transparent;
  color: inherit;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  cursor: pointer;
}

.assets-manifest thead th > button:hover,
.assets-manifest thead th > button:focus-visible {
  color: var(--ui-primary);
}

.assets-manifest thead th > button:focus-visible {
  outline: 0.125rem solid var(--ui-primary);
  outline-offset: 0.125rem;
}

.assets-manifest thead th[aria-sort] {
  color: var(--ui-primary);
}

.assets-filtered-empty,
.assets-empty {
  min-width: 0;
  border: 0.0625rem solid var(--ui-border);
  background: var(--ui-surface);
}
</style>
