<script setup lang="ts">
import MarketQuickbarFolder from './MarketQuickbarFolder.vue'
import MarketQuickbarItem from './MarketQuickbarItem.vue'
import { rootQuickbarFolderId } from '../market-quickbar'
import { marketQuickbarPanelKey } from '../market-quickbar-panel-context'
import {
  marketQuickbarNodeChildren,
  marketQuickbarNodeKey,
  type MarketQuickbarNode,
} from '../market-quickbar-tree'
import { marketTypeImageSources } from '../useMarketTypeImage'
import type { MarketGroup, MarketType } from '../market-catalogue-types'
import type { MarketQuickbar } from '../useMarketQuickbar'

const props = defineProps<{
  groups: readonly MarketGroup[]
  indexReady: boolean
  indexUnavailable: boolean
  quickbar: MarketQuickbar
  selectedId: number | null
}>()
const emit = defineEmits<{
  select: [item: MarketType]
  removeItem: [id: number]
  import: []
  export: []
  clear: []
}>()

const { showToast } = useToast()
const { typeImage } = useEveImages()
const editingFolderId = ref<string | null>(null)
const moveTargetKey = ref<string | null>(null)
const clearOpen = ref(false)
const quickbar = props.quickbar
const { dropOnFolder, empty, expanded, nodes, persistent, selectedNode, unavailablePinnedIds } =
  quickbar
const itemCount = computed(() => quickbar.pinnedTypeIds.value.length)
const folderCount = computed(() => Object.keys(quickbar.state.value).length - 1)
const summary = computed(() => {
  const items = `${itemCount.value} ${itemCount.value === 1 ? 'item' : 'items'}`
  if (!folderCount.value) return items
  return `${items} · ${folderCount.value} ${folderCount.value === 1 ? 'folder' : 'folders'}`
})
const waitingForIndex = computed(() => itemCount.value > 0 && !props.indexReady)
const nodeLabel = (node: MarketQuickbarNode) =>
  node.kind === 'folder' ? node.name : node.item.name
const itemFolderId = (id: number) =>
  Object.keys(quickbar.state.value).find((key) => quickbar.state.value[key]?.types.includes(id)) ??
  rootQuickbarFolderId

provide(marketQuickbarPanelKey, {
  state: quickbar.state,
  folderOptions: quickbar.folderOptions,
  selectedId: toRef(props, 'selectedId'),
  editingFolderId,
  moveTargetKey,
  itemImage: (item) => marketTypeImageSources(typeImage, item, props.groups),
  select: (item) => emit('select', item),
  removeItem: (id) => emit('removeItem', id),
  moveItem: (id, destinationId) => quickbar.moveItem(id, destinationId),
  moveFolder: (id, destinationId) => quickbar.moveFolder(id, destinationId),
  renameFolder: (id, name) => quickbar.renameFolder(id, name),
  removeFolder: (id) => quickbar.removeFolder(id),
  toggleFolder: (id) => quickbar.toggleFolder(id),
  drop: (data, destinationId) => dropOnFolder(data, destinationId),
})

const addFolder = () => {
  const existing = new Set(Object.keys(quickbar.state.value))
  if (quickbar.createRootFolder('New folder').status !== 'applied') {
    showToast({
      title: 'Quickbar action failed',
      description: 'A new folder could not be created.',
    })
    return
  }
  moveTargetKey.value = null
  editingFolderId.value = Object.keys(quickbar.state.value).find((id) => !existing.has(id)) ?? null
}
const confirmClear = () => {
  clearOpen.value = false
  editingFolderId.value = null
  moveTargetKey.value = null
  emit('clear')
}
</script>

<template>
  <div class="market-quickbar-panel">
    <div class="market-quickbar-panel__toolbar">
      <output class="market-quickbar-panel__summary">{{ summary }}</output>
      <button
        type="button"
        class="market-quickbar-panel__tool"
        aria-label="New folder"
        title="New folder"
        @click="addFolder"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M3 6h6l2 2h10v11H3z" />
          <path d="M12 11v5M9.5 13.5h5" />
        </svg>
      </button>
      <UiDropdownMenu label="Quickbar" description="Saved in this browser">
        <template #trigger>
          <button
            type="button"
            class="market-quickbar-panel__tool"
            aria-label="More Quickbar actions"
            title="More actions"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <circle cx="5" cy="12" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="19" cy="12" r="1.6" />
            </svg>
          </button>
        </template>
        <UiDropdownMenuItem :disabled="!indexReady" @select="emit('import')">
          Import from clipboard
        </UiDropdownMenuItem>
        <UiDropdownMenuItem :disabled="waitingForIndex" @select="emit('export')">
          Export to clipboard
        </UiDropdownMenuItem>
        <UiDropdownMenuItem tone="danger" :disabled="empty" @select="clearOpen = true">
          Clear Quickbar
        </UiDropdownMenuItem>
      </UiDropdownMenu>
    </div>
    <div class="market-quickbar-panel__body">
      <div v-if="empty" class="market-quickbar-panel__empty">
        <p>Quickbar is empty</p>
        <p>Pin an item from its market page to keep it here.</p>
      </div>
      <output v-else-if="waitingForIndex && indexUnavailable" class="market-quickbar-panel__status">
        Quickbar items are unavailable
      </output>
      <output v-else-if="waitingForIndex" class="market-quickbar-panel__status">
        Loading Quickbar items
      </output>
      <UiSortableTreeRoot
        v-else
        v-slot="{ flattenItems }"
        v-model:expanded="expanded"
        class="market-quickbar-panel__drop-zone"
        aria-label="Quickbar folders and items"
        :items="nodes"
        :get-key="marketQuickbarNodeKey"
        :get-children="marketQuickbarNodeChildren"
        :get-label="nodeLabel"
        :model-value="selectedNode"
        :can-move="quickbar.canSort"
        @move="quickbar.sort"
      >
        <template v-for="entry in flattenItems" :key="entry._id">
          <MarketQuickbarFolder
            v-if="entry.value.kind === 'folder'"
            :level="entry.level"
            :node="entry.value"
          />
          <MarketQuickbarItem
            v-else
            :folder-id="itemFolderId(entry.value.id)"
            :level="entry.level"
            :node="entry.value"
          />
        </template>
      </UiSortableTreeRoot>
      <ul
        v-if="unavailablePinnedIds.length"
        class="market-quickbar-panel__unavailable"
        aria-label="Unavailable saved items"
      >
        <li v-for="id in unavailablePinnedIds" :key="id">
          <span>Item {{ id }} is no longer in the catalogue</span>
          <button
            type="button"
            :aria-label="`Remove item ${id} from Quickbar`"
            @click="emit('removeItem', id)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </li>
      </ul>
      <output v-if="!persistent" class="market-quickbar-panel__status">
        Browser storage is unavailable; saved items will be lost on reload.
      </output>
    </div>
    <UiConfirmDialog
      v-model:open="clearOpen"
      title="Clear Quickbar"
      description="Remove all saved items and folders from this browser?"
      confirm-label="Clear Quickbar"
      tone="danger"
      @confirm="confirmClear"
    />
  </div>
</template>

<style scoped>
.market-quickbar-panel {
  min-width: 0;
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}
.market-quickbar-panel__toolbar {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 0.625rem 0.5rem 0.875rem;
  border-bottom: 1px solid color-mix(in srgb, var(--ui-border) 64%, transparent);
}
.market-quickbar-panel__summary {
  min-width: 0;
  margin-right: auto;
  overflow: hidden;
  color: var(--ui-text-muted);
  font: 700 0.5625rem/1 var(--ui-font-mono);
  letter-spacing: 0.13em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}
.market-quickbar-panel__tool {
  width: 1.875rem;
  height: 1.875rem;
  flex: 0 0 1.875rem;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--ui-border-strong);
  background: transparent;
  color: var(--ui-text-muted);
  cursor: pointer;
}
.market-quickbar-panel__tool:hover,
.market-quickbar-panel__tool[data-state='open'] {
  border-color: var(--ui-primary);
  color: var(--ui-primary);
}
.market-quickbar-panel__tool[data-state='open'] {
  background: color-mix(in srgb, var(--ui-primary) 12%, transparent);
}
.market-quickbar-panel__tool svg {
  width: 0.9375rem;
  height: 0.9375rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
}
.market-quickbar-panel__tool circle {
  fill: currentColor;
  stroke: none;
}
.market-quickbar-panel__body {
  min-height: 0;
  flex: 1;
  padding: 0.375rem 0 0.625rem;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-color: color-mix(in srgb, var(--ui-primary) 30%, transparent) transparent;
  scrollbar-width: thin;
}
.market-quickbar-panel__drop-zone {
  min-height: 2rem;
}
.market-quickbar-panel__drop-zone :deep(ul) {
  margin: 0;
  padding: 0;
  list-style: none;
}
.market-quickbar-panel__empty {
  display: grid;
  justify-items: center;
  gap: 0.5rem;
  padding: 1.75rem 1.125rem;
  text-align: center;
}
.market-quickbar-panel__empty p {
  margin: 0;
  font-size: 0.875rem;
}
.market-quickbar-panel__empty p + p {
  color: var(--ui-text-muted);
  font-size: 0.8125rem;
  line-height: 1.45;
  text-wrap: pretty;
}
.market-quickbar-panel__status {
  display: block;
  padding: 0.75rem 0.875rem;
  color: var(--ui-text-muted);
  font-size: 0.8125rem;
}
.market-quickbar-panel__unavailable {
  margin: 0.5rem 0 0;
  padding: 0;
  list-style: none;
}
.market-quickbar-panel__unavailable li {
  min-height: 2rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.5rem 0 0.875rem;
  color: var(--ui-text-muted);
  font-size: 0.8125rem;
}
.market-quickbar-panel__unavailable span {
  min-width: 0;
  flex: 1;
}
.market-quickbar-panel__unavailable button {
  width: 1.625rem;
  height: 1.625rem;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ui-text-muted);
  cursor: pointer;
}
.market-quickbar-panel__unavailable button:hover {
  color: var(--ui-danger);
}
.market-quickbar-panel__unavailable svg {
  width: 0.875rem;
  height: 0.875rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
}
.market-quickbar-panel :focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: -2px;
}
</style>
