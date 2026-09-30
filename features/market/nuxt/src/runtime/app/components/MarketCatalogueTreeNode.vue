<script setup lang="ts">
import { useMarketGroupItems } from '../useMarketGroupItems'
import { marketGroupIconUrl } from '../market-group-icons'
import type { MarketGroup, MarketType } from '../market-catalogue-types'
import MarketQuickbarPinIcon from './MarketQuickbarPinIcon.vue'

defineOptions({ name: 'MarketCatalogueTreeNode' })

const props = defineProps<{
  canPinNew: boolean
  children: ReadonlyMap<number | null, readonly MarketGroup[]>
  collapseToken: number
  expandedKeys: readonly string[]
  group: MarketGroup
  level: number
  pinnedIds: readonly number[]
  revisionKey: string
  selectedId: number | null
}>()
const emit = defineEmits<{
  select: [item: MarketType]
  toggle: [id: number]
  togglePin: [item: MarketType]
}>()
const subgroupPage = ref(0)
const endMarker = ref<HTMLElement | null>(null)
const subgroups = computed(() => props.children.get(props.group.id) ?? [])
const hasChildren = computed(() => subgroups.value.length > 0 || props.group.directTypeCount > 0)
const visibleSubgroups = computed(() =>
  subgroups.value.slice(subgroupPage.value * 100, (subgroupPage.value + 1) * 100),
)
const subgroupStart = computed(() => subgroupPage.value * 100 + 1)
const subgroupEnd = computed(() => Math.min((subgroupPage.value + 1) * 100, subgroups.value.length))
const isExpanded = computed(() => props.expandedKeys.includes(`group:${props.group.id}`))
const revision = computed(() => props.revisionKey)
const groupId = computed(() => props.group.id)
const itemsEnabled = computed(() => props.group.directTypeCount > 0 && isExpanded.value)
const {
  items: pageItems,
  status: itemStatus,
  hasMore,
  loadMore,
  retry,
} = useMarketGroupItems(revision, groupId, itemsEnabled)
const loading = computed(() => itemStatus.value === 'loading')
const iconSource = computed(() =>
  props.group.iconId ? marketGroupIconUrl(props.group.iconId) : null,
)
const selectGroup = (event: { preventDefault: () => void; detail: { originalEvent: Event } }) => {
  event.preventDefault()
  if (event.detail.originalEvent.type === 'keydown') emit('toggle', props.group.id)
}
let endObserver: IntersectionObserver | undefined
const observeEnd = () => {
  endObserver?.disconnect()
  if (!endMarker.value || !isExpanded.value || !hasMore.value) return
  if (typeof IntersectionObserver === 'undefined') return
  endObserver = new IntersectionObserver(([entry]) => {
    if (entry?.isIntersecting && isExpanded.value) loadMore()
  })
  endObserver.observe(endMarker.value)
}
watch([endMarker, isExpanded, hasMore], observeEnd, {
  flush: 'post',
  immediate: true,
})
onUnmounted(() => endObserver?.disconnect())

watch(
  () => props.revisionKey,
  () => {
    subgroupPage.value = 0
  },
)
watch(
  () => props.collapseToken,
  () => {
    subgroupPage.value = 0
  },
)
</script>

<template>
  <UiTreeItem
    v-slot="{ isExpanded: open }"
    class="market-catalogue-group"
    :level="level"
    :value="group"
    :aria-label="`${group.name}, ${subgroups.length} subgroups, ${group.directTypeCount} direct items`"
    @select="selectGroup"
  >
    <div class="market-catalogue-group__row">
      <UiDisclosureChevron v-if="hasChildren" :open="open" />
      <span v-else class="market-catalogue-group__leaf" aria-hidden="true"></span>
      <span class="market-catalogue-group__icon-frame">
        <img
          v-if="iconSource"
          class="market-catalogue-group__icon"
          :src="iconSource"
          alt=""
          width="18"
          height="18"
          loading="lazy"
          decoding="async"
        />
        <svg
          v-else
          class="market-catalogue-group__icon market-catalogue-group__icon--fallback"
          viewBox="0 0 20 20"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M2.5 5.5h6l1.5 2h7.5v8h-15z" />
        </svg>
      </span>
      <span class="market-catalogue-group__name">{{ group.name }}</span>
    </div>
    <template v-if="open">
      <output v-if="subgroups.length > 100" @click.stop>
        Subgroups {{ subgroupStart }}–{{ subgroupEnd }} of {{ subgroups.length }}
      </output>
      <ul v-if="subgroups.length" role="group" :aria-label="`${group.name} subgroups`">
        <MarketCatalogueTreeNode
          v-for="child in visibleSubgroups"
          :key="child.id"
          :can-pin-new="canPinNew"
          :children="children"
          :collapse-token="collapseToken"
          :expanded-keys="expandedKeys"
          :group="child"
          :level="level + 1"
          :pinned-ids="pinnedIds"
          :revision-key="revisionKey"
          :selected-id="selectedId"
          @select="emit('select', $event)"
          @toggle-pin="emit('togglePin', $event)"
          @toggle="emit('toggle', $event)"
        />
      </ul>
      <button v-if="subgroupPage > 0" type="button" @click.stop="subgroupPage -= 1">
        Previous subgroups
      </button>
      <button
        v-if="(subgroupPage + 1) * 100 < subgroups.length"
        type="button"
        @click.stop="subgroupPage += 1"
      >
        More subgroups
      </button>
      <section v-if="group.directTypeCount" :aria-label="`${group.name} items`" @click.stop>
        <output v-if="loading && !pageItems.length">Loading {{ group.name }} items</output>
        <output v-if="itemStatus === 'unavailable' && !pageItems.length">
          {{ group.name }} items are unavailable
        </output>
        <template v-if="pageItems.length">
          <ul role="group">
            <UiTreeItem
              v-for="item in pageItems"
              :key="item.id"
              class="market-catalogue-item"
              :level="level + 1"
              :value="item"
              :title="item.name"
              @select="emit('select', item)"
            >
              <span class="market-catalogue-item__name">{{ item.name }}</span>
              <button
                type="button"
                class="market-catalogue-item__pin"
                :class="{ 'market-catalogue-item__pin--pinned': pinnedIds.includes(item.id) }"
                :aria-label="`${pinnedIds.includes(item.id) ? 'Remove' : 'Add'} ${item.name} ${pinnedIds.includes(item.id) ? 'from' : 'to'} Quickbar`"
                :disabled="!canPinNew && !pinnedIds.includes(item.id)"
                @click.stop="emit('togglePin', item)"
                @keydown.stop
              >
                <MarketQuickbarPinIcon :filled="pinnedIds.includes(item.id)" />
              </button>
            </UiTreeItem>
          </ul>
          <span v-if="hasMore" ref="endMarker" aria-hidden="true"></span>
          <output v-if="loading">Loading more {{ group.name }} items</output>
          <output v-if="itemStatus === 'unavailable'"
            >More {{ group.name }} items are unavailable</output
          >
          <button v-if="itemStatus === 'unavailable'" type="button" @click.stop="retry">
            Retry loading items
          </button>
        </template>
      </section>
    </template>
  </UiTreeItem>
</template>

<style scoped>
.market-catalogue-group ul {
  list-style: none;
  margin: 0;
  padding-inline-start: 0.875rem;
}
.market-catalogue-group {
  min-width: 0;
  outline: none;
}
.market-catalogue-group__row {
  min-width: 0;
  min-height: 2rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.5rem;
  color: var(--ui-text);
  font-size: 0.875rem;
  cursor: pointer;
}
.market-catalogue-group__row:hover,
.market-catalogue-group:focus-visible > .market-catalogue-group__row {
  background: color-mix(in srgb, var(--ui-primary) 6%, transparent);
}
.market-catalogue-group:focus-visible > .market-catalogue-group__row {
  outline: 2px solid var(--ui-primary);
  outline-offset: -2px;
}
.market-catalogue-group[data-expanded] > .market-catalogue-group__row {
  color: var(--ui-primary);
}
.market-catalogue-group__leaf {
  width: 0.625rem;
  flex: 0 0 0.625rem;
}
.market-catalogue-group__leaf::before {
  content: '';
  width: 0.125rem;
  height: 0.125rem;
  display: block;
  margin: auto;
  background: var(--ui-text-faint);
}
.market-catalogue-group__icon-frame {
  width: 1.25rem;
  height: 1.25rem;
  flex: 0 0 1.25rem;
  display: grid;
  place-items: center;
  border: 1px solid var(--ui-border);
  background: var(--ui-surface-solid);
  overflow: hidden;
}
.market-catalogue-group__icon {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.market-catalogue-group__icon--fallback {
  width: 0.75rem;
  height: 0.75rem;
  fill: var(--ui-text-subtle);
}
.market-catalogue-group__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.market-catalogue-item {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  min-height: 2rem;
  display: flex;
  align-items: center;
  padding: 0 0.25rem 0 0.625rem;
  color: var(--ui-text-muted);
  font: 0.875rem/1.2 var(--ui-font-body);
  cursor: pointer;
  outline: none;
}
.market-catalogue-item::before {
  content: '';
  position: absolute;
  inset: 0.25rem auto 0.25rem 0;
  width: 2px;
  background: transparent;
}
.market-catalogue-item__name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.market-catalogue-item .market-catalogue-item__pin {
  width: 1.5rem;
  min-height: 1.5rem;
  flex: 0 0 1.5rem;
  display: grid;
  place-items: center;
  padding: 0;
  margin: 0;
  border: 0;
  background: transparent;
  opacity: 0;
  color: var(--ui-text-muted);
  cursor: pointer;
}
.market-catalogue-item:hover .market-catalogue-item__pin,
.market-catalogue-item:focus-within .market-catalogue-item__pin,
.market-catalogue-item .market-catalogue-item__pin--pinned {
  opacity: 1;
}
.market-catalogue-item .market-catalogue-item__pin--pinned,
.market-catalogue-item .market-catalogue-item__pin:hover,
.market-catalogue-item .market-catalogue-item__pin:focus-visible {
  color: var(--ui-primary);
}
.market-catalogue-item .market-catalogue-item__pin:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
@media (hover: none) {
  .market-catalogue-item .market-catalogue-item__pin {
    opacity: 1;
  }
}
.market-catalogue-item:hover {
  background: color-mix(in srgb, var(--ui-primary) 8%, transparent);
  color: var(--ui-text);
}
.market-catalogue-item:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: -2px;
}
.market-catalogue-item[data-selected] {
  background: color-mix(in srgb, var(--ui-primary) 12%, transparent);
  color: var(--ui-text);
}
.market-catalogue-item[data-selected]::before {
  background: var(--ui-primary);
}
.market-catalogue-group section > output {
  display: block;
  padding: 0.375rem 0.625rem;
  color: var(--ui-text-muted);
  font-size: 0.75rem;
}
.market-catalogue-group button:not(.market-catalogue-item__pin) {
  max-width: 100%;
  min-height: 2rem;
  padding: 0.3rem 0.625rem;
  border: 0;
  background: transparent;
  color: var(--ui-primary);
  font: 0.8125rem/1.2 var(--ui-font-body);
  text-align: start;
  cursor: pointer;
}
</style>
