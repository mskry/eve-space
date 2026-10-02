<script setup lang="ts">
import MarketQuickbarMoveTargets from './MarketQuickbarMoveTargets.vue'
import MarketQuickbarRow from './MarketQuickbarRow.vue'
import MarketQuickbarRowAction from './MarketQuickbarRowAction.vue'
import { marketQuickbarFolderParent, rootQuickbarFolderId } from '../market-quickbar'
import { marketQuickbarMoveTargets, useMarketQuickbarPanel } from '../market-quickbar-panel-context'
import {
  marketQuickbarFolderItemCount,
  marketQuickbarNodeKey,
  type MarketQuickbarFolderNode,
} from '../market-quickbar-tree'

defineOptions({ name: 'MarketQuickbarFolder' })

const props = defineProps<{
  level: number
  node: MarketQuickbarFolderNode
}>()
const panel = useMarketQuickbarPanel()
const key = computed(() => marketQuickbarNodeKey(props.node))
const editing = computed(() => panel.editingFolderId.value === props.node.id)
const moveOpen = computed(() => panel.moveTargetKey.value === key.value)
const itemCount = computed(() => marketQuickbarFolderItemCount(props.node))
const targets = computed(() => {
  if (!moveOpen.value) return []
  const parentId =
    marketQuickbarFolderParent(panel.state.value, props.node.id) ?? rootQuickbarFolderId
  return marketQuickbarMoveTargets(
    panel.state.value,
    panel.folderOptions.value,
    parentId,
    props.node.id,
  )
})
const indent = computed(() => `${0.875 + (props.level - 1) * 1.625}rem`)
const vSelectOnMount = { mounted: (element: HTMLInputElement) => element.select() }

const selectFolder = (event: CustomEvent<{ originalEvent: Event }>) => {
  event.preventDefault()
  if (event.detail.originalEvent.type === 'keydown') panel.toggleFolder(props.node.id)
}
const startRename = () => {
  panel.moveTargetKey.value = null
  panel.editingFolderId.value = props.node.id
}
const commitRename = (event: Event) => {
  if (!editing.value || !(event.target instanceof HTMLInputElement)) return
  panel.editingFolderId.value = null
  panel.renameFolder(props.node.id, event.target.value)
}
const cancelRename = () => {
  panel.editingFolderId.value = null
}
const toggleMove = () => {
  panel.moveTargetKey.value = moveOpen.value ? null : key.value
}
const move = (destinationId: string) => {
  panel.moveTargetKey.value = null
  panel.moveFolder(props.node.id, destinationId)
}
</script>

<template>
  <UiSortableTreeItem
    v-slot="{ isExpanded }"
    class="market-quickbar-folder"
    :style="{ '--market-quickbar-indent': indent }"
    :item-key="key"
    :disabled="editing"
    :level="level"
    :value="node"
    @select="selectFolder"
  >
    <MarketQuickbarRow :actions-visible="moveOpen">
      <UiDisclosureChevron :open="isExpanded" />
      <svg
        class="market-quickbar-folder__icon"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M3 6h6l2 2h10v11H3z" />
      </svg>
      <input
        v-if="editing"
        v-select-on-mount
        class="market-quickbar-folder__rename"
        :value="node.name"
        aria-label="Folder name"
        maxlength="80"
        @click.stop
        @keydown.stop
        @keydown.enter.prevent="commitRename"
        @keydown.escape.prevent="cancelRename"
        @blur="commitRename"
      />
      <template v-else>
        <span class="market-quickbar-folder__name">{{ node.name }}</span>
        <span class="market-quickbar-folder__count">{{ itemCount }}</span>
      </template>
      <template v-if="!editing" #actions>
        <MarketQuickbarRowAction icon="rename" :label="`Rename ${node.name}`" @run="startRename" />
        <MarketQuickbarRowAction
          icon="move"
          :label="`Move ${node.name} to folder`"
          :aria-expanded="moveOpen"
          @run="toggleMove"
        />
        <MarketQuickbarRowAction
          icon="delete"
          tone="danger"
          :label="`Delete ${node.name}; its contents move up a level`"
          @run="panel.removeFolder(node.id)"
        />
      </template>
    </MarketQuickbarRow>
    <MarketQuickbarMoveTargets
      v-if="moveOpen"
      :label="`Move ${node.name} to`"
      :targets="targets"
      @pick="move"
    />
  </UiSortableTreeItem>
</template>

<style scoped>
.market-quickbar-folder {
  min-width: 0;
  outline: none;
  cursor: pointer;
}
.market-quickbar-folder:focus-visible > :first-child {
  outline: 2px solid var(--ui-primary);
  outline-offset: -2px;
}
.market-quickbar-folder ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.market-quickbar-folder__icon {
  width: 0.9375rem;
  height: 0.9375rem;
  flex: 0 0 0.9375rem;
  fill: none;
  stroke: var(--ui-text-muted);
  stroke-width: 1.6;
}
.market-quickbar-folder__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.market-quickbar-folder__count {
  flex: 0 0 auto;
  color: var(--ui-text-faint);
  font: 700 0.5625rem/1 var(--ui-font-mono);
}
.market-quickbar-folder__rename {
  min-width: 0;
  height: 1.5rem;
  flex: 1;
  padding: 0 0.375rem;
  border: 1px solid var(--ui-primary);
  outline: 0;
  background: var(--ui-control);
  color: var(--ui-text);
  font: 0.875rem/1 var(--ui-font-body);
}
</style>
