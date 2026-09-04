<script setup lang="ts">
import type { AssetVisibleRow } from '../../types/assets'
import {
  assetBlueprintLabel,
  assetImageKind,
  assetPlacementLabel,
  isSkinAsset,
} from '../../utils/assets-hierarchy'

const props = defineProps<{
  expanded: boolean
  visibleRow: AssetVisibleRow
}>()

const emit = defineEmits<{
  itemInformation: [itemId: number]
  toggle: [itemId: number]
}>()

const asset = computed(() => props.visibleRow.row.asset)
const hasChildren = computed(() => props.visibleRow.row.children.length > 0)
const customIdentity = computed(() => asset.value.customName?.trim() || null)
const identityLabel = computed(() =>
  customIdentity.value ? `${asset.value.typeName} (${customIdentity.value})` : asset.value.typeName,
)
const imageKind = computed(() => assetImageKind(asset.value))
const imageSource = computed(() => (isSkinAsset(asset.value) ? '/images/eve-skin.png' : null))
// The Restricted structure group header already states this.
const visibleIssues = computed(() =>
  props.visibleRow.row.issues.filter((issue) => issue !== 'missing-parent'),
)
const quantityLabel = computed(() =>
  asset.value.quantity >= 0 ? asset.value.quantity.toLocaleString('en-US') : 'Unknown',
)
const blueprintLabel = computed(() => assetBlueprintLabel(asset.value))
const flagLabel = computed(() => assetPlacementLabel(asset.value.locationFlag))

function formatVolume(value: number | null) {
  if (value === null || !Number.isFinite(value) || value < 0) return 'Unknown'
  const digits = value >= 100_000 ? 0 : 2
  return `${value.toLocaleString('en-US', { maximumFractionDigits: digits })} m³`
}

function issueLabel(issue: (typeof props.visibleRow.row.issues)[number]) {
  if (issue === 'missing-parent') return 'No structure access'
  if (issue === 'self-link') return 'Self-linked container'
  if (issue === 'cycle') return 'Broken container cycle'
  return 'Duplicate item identity'
}
</script>

<template>
  <tr
    class="assets-hierarchy-row"
    :class="{
      'assets-hierarchy-row--nested': visibleRow.depth > 0,
    }"
    :style="{ '--assets-depth': Math.min(visibleRow.depth, 12) }"
    :data-asset-item-id="asset.itemId"
    :data-depth="visibleRow.depth"
  >
    <td class="assets-hierarchy-item">
      <div class="assets-hierarchy-item-layout">
        <span class="assets-hierarchy-rail" aria-hidden="true"></span>
        <button
          v-if="hasChildren"
          class="assets-hierarchy-toggle"
          type="button"
          :aria-expanded="expanded"
          :aria-label="`${expanded ? 'Collapse' : 'Expand'} ${identityLabel}`"
          @click="emit('toggle', asset.itemId)"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <rect x="4" y="7" width="8" height="2" />
            <rect v-if="!expanded" x="7" y="4" width="2" height="8" />
          </svg>
        </button>
        <span v-else class="assets-hierarchy-leaf" aria-hidden="true"></span>

        <img
          v-if="imageSource"
          class="assets-hierarchy-image"
          :src="imageSource"
          alt=""
          width="32"
          height="32"
        />
        <UiEveImage v-else :kind="imageKind" :id="asset.typeId" :dimension="32" alt="" />
        <span class="assets-hierarchy-identity">
          <AssetsItemInformation
            :asset="asset"
            @activate="emit('itemInformation', $event.itemId)"
          />
          <span v-if="customIdentity" class="assets-hierarchy-custom-name">{{
            customIdentity
          }}</span>
        </span>
        <span v-if="blueprintLabel" class="assets-hierarchy-badge">{{ blueprintLabel }}</span>
        <ul
          v-if="visibleIssues.length > 0"
          class="assets-hierarchy-issues"
          aria-label="Placement issues"
        >
          <li v-for="issue in visibleIssues" :key="issue">{{ issueLabel(issue) }}</li>
        </ul>
      </div>
    </td>
    <td class="assets-hierarchy-number">{{ quantityLabel }}</td>
    <td>{{ asset.groupName || 'Unknown group' }}</td>
    <td>{{ asset.categoryName || 'Unknown category' }}</td>
    <td>{{ flagLabel }}</td>
    <td class="assets-hierarchy-number">{{ formatVolume(asset.totalVolume) }}</td>
    <td class="assets-hierarchy-number">{{ formatVolume(asset.unitVolume) }}</td>
  </tr>
</template>

<style scoped>
.assets-hierarchy-row {
  --assets-indent: calc(min(var(--assets-depth), 12) * 1.25rem);
  background: color-mix(in srgb, var(--ui-surface) 86%, transparent);
}

.assets-hierarchy-row > td {
  min-width: 0;
  height: var(--character-item-row-height);
  padding: 0 0.75rem;
  border-bottom: 0.0625rem solid var(--ui-border);
  color: var(--ui-text-muted);
  font: 500 var(--character-data-size) / 1.2 var(--ui-font-mono);
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
}

.assets-hierarchy-row > .assets-hierarchy-item {
  padding: 0;
  overflow: visible;
}

.assets-hierarchy-item-layout {
  position: relative;
  min-width: 0;
  min-height: var(--character-item-row-height);
  padding-left: calc(0.875rem + var(--assets-indent));
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.assets-hierarchy-number {
  text-align: right;
}

.assets-hierarchy-row--nested {
  background: color-mix(in srgb, var(--ui-control) 83%, var(--ui-primary) 2%);
}

.assets-hierarchy-row:hover {
  background: color-mix(in srgb, var(--ui-primary) 6%, var(--ui-surface-raised));
}

.assets-hierarchy-row:hover :deep(.app-information-icon) {
  color: var(--ui-primary);
}

.assets-hierarchy-rail {
  position: absolute;
  inset: 0 auto 0 calc(0.875rem + var(--assets-indent) - 1.25rem + 0.5625rem);
  width: 0.0625rem;
  background: color-mix(in srgb, var(--ui-primary) 28%, var(--ui-border));
}

.assets-hierarchy-row:not(.assets-hierarchy-row--nested) .assets-hierarchy-rail {
  display: none;
}

.assets-hierarchy-toggle,
.assets-hierarchy-leaf {
  box-sizing: border-box;
  width: 1.125rem;
  height: 1.125rem;
  flex: 0 0 1.125rem;
  display: grid;
  place-items: center;
}

.assets-hierarchy-toggle {
  /* The base reset only sets `font` on buttons, so UA padding and native appearance survive
     and push the mark off centre. */
  appearance: none;
  padding: 0;
  border: 0.0625rem solid var(--ui-border-strong);
  color: var(--ui-primary);
  background: var(--ui-control);
  cursor: pointer;
}

.assets-hierarchy-toggle svg {
  width: 0.875rem;
  height: 0.875rem;
  display: block;
  fill: currentColor;
}

.assets-hierarchy-toggle:hover {
  border-color: var(--ui-primary);
}

.assets-hierarchy-toggle:focus-visible {
  outline: 0.125rem solid var(--ui-primary);
  outline-offset: 0.125rem;
}

.assets-hierarchy-leaf::before {
  content: '';
  width: 0.125rem;
  height: 0.125rem;
  display: block;
  background: var(--ui-text-faint);
}

.assets-hierarchy-row :deep(.ui-eve-image),
.assets-hierarchy-image {
  width: 2rem;
  height: 2rem;
  display: block;
  flex: 0 0 2rem;
  align-self: center;
  border: 0.0625rem solid var(--ui-border);
  background: var(--ui-control);
  object-fit: contain;
}

.assets-hierarchy-identity {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  overflow: hidden;
}

.assets-hierarchy-custom-name {
  flex: 0 1 auto;
  color: var(--ui-text-subtle);
  font: 500 var(--character-data-size) / 1.2 var(--ui-font-mono);
  letter-spacing: 0.02em;
  overflow: hidden;
  text-overflow: ellipsis;
}

.assets-hierarchy-identity :deep(.assets-item-information-trigger) {
  min-width: 0;
  flex: 0 1 auto;
  color: var(--ui-text);
  font: 400 var(--character-item-title-size) / 1.2 var(--ui-font-body);
}

.assets-hierarchy-identity :deep(.assets-item-information-type) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assets-hierarchy-badge {
  flex: 0 0 auto;
  padding: 0.2rem 0.3rem;
  border: 0.0625rem solid color-mix(in srgb, var(--ui-primary) 35%, var(--ui-border));
  color: var(--ui-primary);
  font: 700 0.48rem/1 var(--ui-font-mono);
  letter-spacing: 0.05em;
}

.assets-hierarchy-issues {
  flex: 0 0 auto;
  margin: 0;
  padding: 0;
  display: flex;
  gap: 0.3rem;
  list-style: none;
}

.assets-hierarchy-issues li {
  padding: 0.2rem 0.3rem;
  border: 0.0625rem solid color-mix(in srgb, var(--ui-warning) 38%, var(--ui-border));
  color: var(--ui-warning);
  font: 700 0.48rem/1 var(--ui-font-mono);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
</style>
