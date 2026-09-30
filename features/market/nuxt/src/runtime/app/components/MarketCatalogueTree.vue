<script setup lang="ts">
import MarketCatalogueTreeNode from './MarketCatalogueTreeNode.vue'
import type { MarketGroup, MarketTreeEntry, MarketType } from '../market-catalogue-types'

const props = defineProps<{
  canPinNew: boolean
  collapseToken: number
  groups: readonly MarketGroup[]
  pinnedIds: readonly number[]
  revisionKey: string
  selectedId: number | null
}>()
const emit = defineEmits<{ select: [item: MarketType]; togglePin: [item: MarketType] }>()

const children = computed(() => {
  const map = new Map<number | null, MarketGroup[]>()
  for (const group of props.groups) {
    const siblings = map.get(group.parentId) ?? []
    siblings.push(group)
    map.set(group.parentId, siblings)
  }
  for (const siblings of map.values()) {
    siblings.sort((left, right) => left.name.localeCompare(right.name, 'en') || left.id - right.id)
  }
  return map
})
const roots = computed(() => children.value.get(null) ?? [])
const expanded = ref<string[]>([])
const selectedEntry = computed<MarketType | undefined>(() =>
  props.selectedId === null ? undefined : { id: props.selectedId, groupId: 0, name: '' },
)
const getKey = (entry: MarketTreeEntry) =>
  'directTypeCount' in entry ? `group:${entry.id}` : `type:${entry.id}`
const getChildren = (entry: MarketTreeEntry): MarketGroup[] | undefined => {
  if (!('directTypeCount' in entry)) return undefined
  const subgroups = children.value.get(entry.id)
  return subgroups?.length ? subgroups : entry.directTypeCount ? [] : undefined
}
const toggleGroup = (id: number) => {
  const key = `group:${id}`
  expanded.value = expanded.value.includes(key)
    ? expanded.value.filter((expandedKey) => expandedKey !== key)
    : [...expanded.value, key]
}
watch(
  () => props.collapseToken,
  () => {
    expanded.value = []
  },
)
</script>

<template>
  <nav aria-label="Market categories" class="market-catalogue-tree">
    <UiTreeRoot
      v-model:expanded="expanded"
      aria-label="Market categories"
      :items="roots"
      :get-key="getKey"
      :get-children="getChildren"
      :model-value="selectedEntry"
    >
      <MarketCatalogueTreeNode
        v-for="group in roots"
        :key="group.id"
        :can-pin-new="canPinNew"
        :children="children"
        :collapse-token="collapseToken"
        :expanded-keys="expanded"
        :group="group"
        :level="1"
        :pinned-ids="pinnedIds"
        :revision-key="revisionKey"
        :selected-id="selectedId"
        @select="emit('select', $event)"
        @toggle-pin="emit('togglePin', $event)"
        @toggle="toggleGroup"
      />
    </UiTreeRoot>
  </nav>
</template>

<style scoped>
.market-catalogue-tree {
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-color: color-mix(in srgb, var(--ui-text-subtle) 45%, transparent) transparent;
  scrollbar-width: thin;
}
.market-catalogue-tree ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
</style>
