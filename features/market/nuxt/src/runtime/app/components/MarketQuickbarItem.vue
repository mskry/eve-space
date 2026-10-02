<script setup lang="ts">
import MarketQuickbarMoveTargets from './MarketQuickbarMoveTargets.vue'
import MarketQuickbarRow from './MarketQuickbarRow.vue'
import MarketQuickbarRowAction from './MarketQuickbarRowAction.vue'
import { marketQuickbarMoveTargets, useMarketQuickbarPanel } from '../market-quickbar-panel-context'
import { marketQuickbarNodeKey, type MarketQuickbarItemNode } from '../market-quickbar-tree'

const props = defineProps<{
  folderId: string
  level: number
  node: MarketQuickbarItemNode
}>()
const panel = useMarketQuickbarPanel()
const key = computed(() => marketQuickbarNodeKey(props.node))
const selected = computed(() => panel.selectedId.value === props.node.id)
const moveOpen = computed(() => panel.moveTargetKey.value === key.value)
const image = computed(() => panel.itemImage(props.node.item))
const targets = computed(() =>
  moveOpen.value
    ? marketQuickbarMoveTargets(panel.state.value, panel.folderOptions.value, props.folderId)
    : [],
)
const indent = computed(() => `${0.875 + (props.level - 1) * 1.625}rem`)
const toggleMove = () => {
  panel.moveTargetKey.value = moveOpen.value ? null : key.value
}
const move = (destinationId: string) => {
  panel.moveTargetKey.value = null
  panel.moveItem(props.node.id, destinationId)
}
</script>

<template>
  <UiSortableTreeItem
    class="market-quickbar-item"
    :style="{ '--market-quickbar-indent': indent }"
    :item-key="key"
    :level="level"
    :value="node"
    @select="panel.select(node.item)"
  >
    <MarketQuickbarRow :selected="selected" :actions-visible="moveOpen">
      <button
        type="button"
        class="market-quickbar-item__open"
        :aria-current="selected ? 'true' : undefined"
        :title="node.item.name"
        @click.stop="panel.select(node.item)"
        @keydown.enter.stop
        @keydown.space.stop
      >
        <span class="market-quickbar-item__icon">
          <img
            :src="image.source"
            :srcset="image.sourceSet"
            alt=""
            width="20"
            height="20"
            loading="lazy"
            decoding="async"
            draggable="false"
          />
        </span>
        <span class="market-quickbar-item__name">{{ node.item.name }}</span>
      </button>
      <template #actions>
        <MarketQuickbarRowAction
          icon="move"
          :label="`Move ${node.item.name} to folder`"
          :aria-expanded="moveOpen"
          @run="toggleMove"
        />
        <MarketQuickbarRowAction
          icon="remove"
          tone="danger"
          :label="`Remove ${node.item.name} from Quickbar`"
          @run="panel.removeItem(node.id)"
        />
      </template>
    </MarketQuickbarRow>
    <MarketQuickbarMoveTargets
      v-if="moveOpen"
      :label="`Move ${node.item.name} to`"
      :targets="targets"
      @pick="move"
    />
  </UiSortableTreeItem>
</template>

<style scoped>
.market-quickbar-item {
  min-width: 0;
  outline: none;
}
.market-quickbar-item:focus-visible > :first-child {
  outline: 2px solid var(--ui-primary);
  outline-offset: -2px;
}
.market-quickbar-item__open {
  min-width: 0;
  height: 100%;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.market-quickbar-item__open[aria-current] {
  color: var(--ui-text);
}
.market-quickbar-item__open:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: -2px;
}
.market-quickbar-item__icon {
  width: 1.25rem;
  height: 1.25rem;
  flex: 0 0 1.25rem;
  display: block;
  border: 1px solid var(--ui-border);
  background: var(--ui-surface-solid);
  overflow: hidden;
}
.market-quickbar-item__icon img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.market-quickbar-item__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
