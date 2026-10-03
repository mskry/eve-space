<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import { readPlatformApiResponse } from '@eve-space/platform-module-nuxt/runtime'
import { useMarketSearch } from '../useMarketSearch'
import { useMarketQuickbar } from '../useMarketQuickbar'
import { useMarketOverview } from '../useMarketOverview'
import { useMarketLastViewedItem } from '../useMarketLastViewedItem'
import { useMarketTypeImage } from '../useMarketTypeImage'
import MarketCatalogueTree from '../components/MarketCatalogueTree.vue'
import MarketQuickbarPanel from '../components/MarketQuickbarPanel.vue'
import MarketBookSummary from '../components/MarketBookSummary.vue'
import MarketOrderTables from '../components/MarketOrderTables.vue'
import MarketPriceHistory from '../components/MarketPriceHistory.vue'
import MarketQuickbarPinIcon from '../components/MarketQuickbarPinIcon.vue'
import { marketBreadcrumbs } from '../market-breadcrumbs'
import { isGlobalPlexItem } from '../market-profile-selection'
import { maxMarketQuickbarItems } from '../market-quickbar'
import type { MarketGroup, MarketType } from '../market-catalogue-types'
import type { QuickbarOutcome } from '../useMarketQuickbar'

definePageMeta({ layout: 'headerless', title: 'Market' })
useHead({ title: 'Market · EVE Space' })

const marketSections = [{ id: 'items', label: 'ITEMS', to: '/market' }] as const

const detailTabs = [
  { label: 'Order book', value: 'data' },
  { label: 'Price History', value: 'history' },
] as const
const historyNoticeCopy = {
  loading: { title: 'Loading daily price history', detail: '', busy: true, action: '' },
  collecting: {
    title: 'Collecting daily price history',
    detail: 'Fetching this item’s history from EVE. This view updates when it arrives.',
    busy: true,
    action: '',
  },
  queued: {
    title: 'Waiting for daily price history',
    detail: 'Your request is in line. This view updates when the data arrives.',
    busy: true,
    action: '',
  },
  waiting: {
    title: 'Daily price history is temporarily unavailable',
    detail: 'Your request is saved. This view updates once history can be fetched again.',
    busy: true,
    action: '',
  },
  limit: {
    title: 'On-demand history limit reached',
    detail:
      'This market already collects daily history for its maximum of 256 requested items. Requests unused for 30 days expire and free a slot.',
    busy: false,
    action: '',
  },
  'timed-out': {
    title: 'Daily price history request is still pending',
    detail: 'Your request is saved. Check again for the result.',
    busy: false,
    action: 'Check again',
  },
  unavailable: {
    title: 'Daily price history could not be requested',
    detail: '',
    busy: false,
    action: 'Try again',
  },
} as const
const marketRegionNames = new Map([
  [10000002, 'The Forge'],
  [10000043, 'Domain'],
  [10000058, 'Heimatar'],
])
const marketProfileLabel = (regionId: number, mode: 'region' | 'watched-types') => {
  const region = marketRegionNames.get(regionId) ?? `Region ${regionId}`
  return mode === 'watched-types' ? `${region} · watched items` : region
}
const api = usePlatformApi()
const { showToast } = useToast()
const route = useRoute()
const router = useRouter()
const initialTypeId = Number(route.query.typeId)
const selectedId = ref<number | null>(
  Number.isSafeInteger(initialTypeId) && initialTypeId > 0 ? initialTypeId : null,
)
const query = ref('')
const activeTab = ref('browse')
const detailTab = ref(route.query.tab === 'history' ? 'history' : 'data')
const selectedType = ref<MarketType | null>(null)
const collapseToken = ref(0)
const searchInput = ref<HTMLInputElement | null>(null)
const showingResults = computed(() => query.value.trim().length >= 4)

const catalogue = useQuery({
  key: ['market', 'catalogue', 'current-tree'],
  staleTime: 30_000,
  query: async ({ signal }) => {
    const discovered = await readPlatformApiResponse(
      await api.api.modules.market.catalogue.revision.$get({}, { init: { signal } }),
      'Market catalogue revision is unavailable.',
    )
    const tree = await readPlatformApiResponse(
      await api.api.modules.market.catalogue.body[':revision'].tree.$get(
        { param: { revision: discovered.key } },
        { init: { signal } },
      ),
      'Market categories are unavailable.',
    )
    if (tree.kind !== 'tree' || tree.revision.ingestedAt !== discovered.revision.ingestedAt) {
      throw new Error('Market tree does not match the current revision')
    }
    return { key: discovered.key, tree }
  },
})
const revisionKey = computed(() => catalogue.data.value?.key ?? '')
const requestedProfileId = computed(() => String(route.query.profileId ?? ''))
const historyActive = computed(() => detailTab.value === 'history')
const {
  item: lookedUpItem,
  itemQuery,
  profiles,
  eligibleProfiles,
  profilesQuery,
  profile,
  orders,
  history,
  historyQuery,
  historyRequest,
  retryHistoryRequest,
} = useMarketOverview(revisionKey, selectedId, requestedProfileId, historyActive)
const book = orders.book
const orderPresentation = orders.presentation
const orderVersion = orders.version
const historyUncollected = computed(() => !history.value || history.value.status === 'uncollected')
const historyNotice = computed<keyof typeof historyNoticeCopy | null>(() => {
  if (!profile.value) return null
  const request = historyRequest.value
  if (request !== 'idle' && historyUncollected.value) return request
  if (historyQuery.asyncStatus.value === 'loading' && !history.value) return 'loading'
  return null
})
onServerPrefetch(async () => {
  if (!selectedId.value) return
  await catalogue.refresh()
  await nextTick()
  await Promise.all([itemQuery.refresh(), profilesQuery.refresh()])
  await nextTick()
  if (!profile.value) return
  if (historyActive.value) await historyQuery.refresh()
  else await orders.load()
})
const syncProfileUrl = (id: string | undefined) => {
  if (!import.meta.client || !id || id === route.query.profileId) return
  if (Number(route.query.typeId) !== selectedId.value) return
  void router.replace({ query: { ...route.query, profileId: id } })
}
watch(() => profile.value?.profileId, syncProfileUrl)
const groups = computed<readonly MarketGroup[]>(() => catalogue.data.value?.tree.groups ?? [])
const searchSource = computed(() => catalogue.data.value ?? null)
const includeIndex = computed(() => activeTab.value === 'quickbar')
const {
  index: currentIndex,
  indexStatus,
  results: suggestions,
  status: marketSearchStatus,
  retry: retrySearch,
} = useMarketSearch(searchSource, query, includeIndex)
const currentTypes = computed(() => currentIndex.value?.types ?? null)
const quickbar = useMarketQuickbar(currentTypes, selectedId)
const {
  message: quickbarMessage,
  pinnedTypeIds,
  addItem: addPinnedType,
  selectedIsPinned,
  canPinSelected,
  removeItem: removePinnedType,
  importQuickbar,
  exportQuickbar,
  clear: clearPinnedItems,
} = quickbar
const marketTabs = computed(() => [
  { label: 'Browse', value: 'browse' },
  {
    label: pinnedTypeIds.value.length ? `Quickbar · ${pinnedTypeIds.value.length}` : 'Quickbar',
    value: 'quickbar',
  },
])

const notifyQuickbar = (
  outcome: QuickbarOutcome,
  notice: {
    successTitle: string
    successDescription: string
    failureDescription: string
    unchangedDescription?: string
  },
) => {
  if (outcome.status === 'rejected') {
    showToast({ title: 'Quickbar action failed', description: notice.failureDescription })
    return
  }
  if (outcome.status === 'unchanged') {
    showToast({
      title: 'Quickbar unchanged',
      description: notice.unchangedDescription ?? notice.successDescription,
    })
    return
  }
  const description =
    outcome.persisted === false
      ? `${notice.successDescription} Browser storage is unavailable; this change lasts only for this session.`
      : notice.successDescription
  showToast({ title: notice.successTitle, description })
}

const pinQuickbarItem = (item: MarketType) => {
  const wasPinned = pinnedTypeIds.value.includes(item.id)
  const outcome = wasPinned ? removePinnedType(item.id) : addPinnedType(item.id)
  notifyQuickbar(outcome, {
    successTitle: wasPinned ? 'Removed from Quickbar' : 'Added to Quickbar',
    successDescription: `${item.name} ${wasPinned ? 'was unpinned' : 'was pinned'}.`,
    failureDescription: `${item.name} could not be ${wasPinned ? 'removed from' : 'added to'} Quickbar.`,
    unchangedDescription: `${item.name} is ${wasPinned ? 'not in' : 'already in'} Quickbar.`,
  })
}

const removeSavedItem = (id: number) => {
  const name = currentIndex.value?.types.find((item) => item.id === id)?.name ?? `Item ${id}`
  notifyQuickbar(removePinnedType(id), {
    successTitle: 'Removed from Quickbar',
    successDescription: `${name} was unpinned.`,
    failureDescription: `${name} could not be removed from Quickbar.`,
  })
}

const importSavedQuickbar = async () => {
  const before = pinnedTypeIds.value.length
  const outcome = await importQuickbar()
  const added = pinnedTypeIds.value.length - before
  notifyQuickbar(outcome, {
    successTitle: 'Quickbar imported',
    successDescription: `Imported items and folders. ${added} new ${added === 1 ? 'item' : 'items'} added.`,
    failureDescription: quickbarMessage.value || 'Quickbar could not be imported.',
    unchangedDescription: quickbarMessage.value || 'This Quickbar is already imported.',
  })
}

const exportSavedQuickbar = async () => {
  const outcome = await exportQuickbar()
  const count = pinnedTypeIds.value.length
  notifyQuickbar(outcome, {
    successTitle: 'Quickbar copied',
    successDescription: `Copied ${count} saved ${count === 1 ? 'item' : 'items'} and folders to the clipboard.`,
    failureDescription: quickbarMessage.value || 'Quickbar could not be copied.',
  })
}

const focusSearchShortcut = (event: KeyboardEvent) => {
  if (event.key.toLowerCase() !== 'k' || !(event.ctrlKey || event.metaKey)) return
  event.preventDefault()
  searchInput.value?.focus()
}
onMounted(() => {
  performance.mark('market-page-mounted')
  document.addEventListener('keydown', focusSearchShortcut)
  syncProfileUrl(profile.value?.profileId)
})
onUnmounted(() => {
  document.removeEventListener('keydown', focusSearchShortcut)
})
watch(
  revisionKey,
  () => {
    selectedType.value = null
  },
  { flush: 'sync' },
)

const selectType = (id: number | null, item?: MarketType) => {
  selectedId.value = id
  selectedType.value = item ?? suggestions.value.find((suggestion) => suggestion.id === id) ?? null
  void router.replace({
    query: {
      ...route.query,
      typeId: id ? String(id) : undefined,
      profileId: profile.value?.profileId,
    },
  })
}
const selectedItem = computed(
  () =>
    lookedUpItem.value ??
    selectedType.value ??
    currentIndex.value?.types.find((item) => item.id === selectedId.value),
)
useMarketLastViewedItem({
  itemId: computed(() => selectedItem.value?.id ?? null),
  hasExplicitSelection: () => route.query.typeId !== undefined,
  restore: selectType,
})
const pinSelectedItem = () => {
  if (selectedItem.value) pinQuickbarItem(selectedItem.value)
}
const selectedGroup = computed(() =>
  groups.value.find((group) => group.id === selectedItem.value?.groupId),
)
const selectedPath = computed(() => marketBreadcrumbs(groups.value, selectedGroup.value?.id))
const selectedIsGlobalPlex = computed(() => isGlobalPlexItem(selectedId.value))
const selectedImage = useMarketTypeImage(selectedItem, groups)
const bookState = orders.presentation
const selectProfile = (event: Event) => {
  if (!(event.target instanceof HTMLSelectElement)) return
  const profileId = event.target.value
  void router.replace({ query: { ...route.query, profileId } })
}
watch(detailTab, (tab) => {
  if (tab !== route.query.tab) {
    void router.replace({ query: { ...route.query, tab: tab === 'history' ? tab : undefined } })
  }
})
watch(
  () => route.query.tab,
  (tab) => {
    detailTab.value = tab === 'history' ? 'history' : 'data'
  },
)
const searchUnavailable = computed(() => marketSearchStatus.value === 'unavailable')
const searching = computed(() => marketSearchStatus.value === 'loading')
const searchStatus = computed(() => {
  if (searchUnavailable.value) return 'Market search is unavailable'
  if (searching.value) return 'Searching market items'
  return `${suggestions.value.length} matching items`
})
const clearQuickbar = () => {
  const count = pinnedTypeIds.value.length
  notifyQuickbar(clearPinnedItems(), {
    successTitle: 'Quickbar cleared',
    successDescription: `Removed ${count} saved ${count === 1 ? 'item' : 'items'} and all folders.`,
    failureDescription: 'Quickbar could not be cleared.',
  })
}
watch(
  () => route.query.typeId,
  (value) => {
    const id = Number(value)
    const next = Number.isSafeInteger(id) && id > 0 ? id : null
    if (next === selectedId.value) return
    selectedId.value = next
    selectedType.value = null
  },
)
</script>

<template>
  <section class="market-catalogue-page">
    <header class="market-catalogue-page__header">
      <span class="market-catalogue-page__icon">
        <AppIcon name="market" />
      </span>
      <div>
        <p class="ui-eyebrow">MARKET / ITEMS</p>
        <h1>Market</h1>
      </div>
    </header>
    <RecordSectionNavigation :entries="marketSections" label="Market sections" />
    <output v-if="catalogue.asyncStatus.value === 'loading' && !revisionKey">
      Loading market categories
    </output>
    <output v-else-if="catalogue.error.value && !revisionKey"
      >Market categories are unavailable</output
    >
    <output v-if="catalogue.asyncStatus.value === 'loading' && revisionKey">
      Checking the current Market revision; showing the previously loaded tree.
    </output>
    <output v-if="catalogue.error.value && revisionKey">
      Showing a previously loaded Market tree. The current SDE revision is unavailable.
    </output>
    <div v-if="revisionKey" class="market-catalogue-page__workspace">
      <aside class="market-catalogue-page__browse" aria-label="Browse market items">
        <UiTabs
          v-model="activeTab"
          aria-label="Market navigation"
          class="market-catalogue-page__tabs"
          :tabs="marketTabs"
        >
          <template #browse>
            <div class="market-catalogue-page__search-row">
              <div class="market-catalogue-page__search">
                <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <circle cx="8.5" cy="8.5" r="5.5" />
                  <path d="m12.5 12.5 4.5 4.5" />
                </svg>
                <input
                  id="market-item-search"
                  ref="searchInput"
                  v-model="query"
                  type="search"
                  aria-label="Search market items"
                  aria-keyshortcuts="Control+K Meta+K"
                  placeholder="Search"
                />
              </div>
              <button
                class="market-catalogue-page__collapse"
                type="button"
                aria-label="Collapse all"
                title="Collapse all"
                @click="collapseToken += 1"
              >
                <svg viewBox="0 0 15 15" aria-hidden="true" focusable="false">
                  <path
                    d="M3.49949 14.9C3.7204 14.9 3.89949 14.7209 3.89949 14.5L3.89949 10.4657L5.21664 11.7829C5.37285 11.9391 5.62612 11.9391 5.78233 11.7829C5.93854 11.6267 5.93854 11.3734 5.78233 11.2172L3.78233 9.21718C3.70732 9.14217 3.60557 9.10002 3.49949 9.10002C3.3934 9.10002 3.29166 9.14217 3.21664 9.21718L1.21664 11.2172C1.06043 11.3734 1.06043 11.6267 1.21664 11.7829C1.37285 11.9391 1.62612 11.9391 1.78233 11.7829L3.09949 10.4657L3.09949 14.5C3.09949 14.7209 3.27857 14.9 3.49949 14.9ZM7.99998 10.5C7.99998 10.7762 8.22383 11 8.49998 11H14.5C14.7761 11 15 10.7762 15 10.5C15 10.2239 14.7761 10 14.5 10H8.49998C8.22383 10 7.99998 10.2239 7.99998 10.5ZM7.99998 7.50002C7.99998 7.77617 8.22383 8.00002 8.49998 8.00002H14.5C14.7761 8.00002 15 7.77617 15 7.50002C15 7.22388 14.7761 7.00002 14.5 7.00002H8.49998C8.22383 7.00002 7.99998 7.22388 7.99998 7.50002ZM8.49998 5.00002C8.22383 5.00002 7.99998 4.77617 7.99998 4.50002C7.99998 4.22388 8.22383 4.00002 8.49998 4.00002H14.5C14.7761 4.00002 15 4.22388 15 4.50002C15 4.77617 14.7761 5.00002 14.5 5.00002H8.49998ZM3.89949 0.500025C3.89949 0.279111 3.7204 0.100025 3.49949 0.100025C3.27857 0.100025 3.09949 0.279111 3.09949 0.500025L3.09949 4.53434L1.78233 3.21718C1.62612 3.06097 1.37285 3.06097 1.21664 3.21718C1.06043 3.37339 1.06043 3.62666 1.21664 3.78287L3.21664 5.78287C3.29166 5.85788 3.3934 5.90002 3.49949 5.90002C3.60557 5.90002 3.70732 5.85788 3.78233 5.78287L5.78233 3.78287C5.93854 3.62666 5.93854 3.37339 5.78233 3.21718C5.62612 3.06097 5.37285 3.06097 5.21664 3.21718L3.89949 4.53434L3.89949 0.500025Z"
                    fill-rule="evenodd"
                    clip-rule="evenodd"
                  />
                </svg>
              </button>
            </div>
            <div v-if="showingResults && searchUnavailable">
              <output>Market search is unavailable</output>
              <button type="button" @click="retrySearch">Retry search</button>
            </div>
            <div v-if="showingResults" class="market-catalogue-page__results">
              <output class="sr-only" aria-live="polite">{{ searchStatus }}</output>
              <output v-if="searching">Searching market items</output>
              <output v-else-if="!suggestions.length && !searchUnavailable"
                >No matching items</output
              >
              <ul v-else-if="!searchUnavailable" aria-label="Market search results">
                <li v-for="item in suggestions" :key="item.id">
                  <button
                    type="button"
                    class="market-catalogue-page__result-select"
                    :aria-current="selectedId === item.id ? 'true' : undefined"
                    @click="selectType(item.id, item)"
                  >
                    {{ item.name }}
                  </button>
                  <button
                    type="button"
                    class="market-catalogue-page__result-pin"
                    :class="{
                      'market-catalogue-page__result-pin--pinned': pinnedTypeIds.includes(item.id),
                    }"
                    :aria-label="`${pinnedTypeIds.includes(item.id) ? 'Remove' : 'Add'} ${item.name} ${pinnedTypeIds.includes(item.id) ? 'from' : 'to'} Quickbar`"
                    :aria-pressed="pinnedTypeIds.includes(item.id)"
                    :disabled="
                      pinnedTypeIds.length >= maxMarketQuickbarItems &&
                      !pinnedTypeIds.includes(item.id)
                    "
                    @click.stop="pinQuickbarItem(item)"
                  >
                    <MarketQuickbarPinIcon :filled="pinnedTypeIds.includes(item.id)" />
                  </button>
                </li>
              </ul>
            </div>
            <MarketCatalogueTree
              v-else
              :can-pin-new="pinnedTypeIds.length < maxMarketQuickbarItems"
              :collapse-token="collapseToken"
              :groups="groups"
              :pinned-ids="pinnedTypeIds"
              :revision-key="revisionKey"
              :selected-id="selectedId"
              @toggle-pin="pinQuickbarItem"
              @select="selectType($event.id, $event)"
            />
          </template>
          <template #quickbar>
            <MarketQuickbarPanel
              :groups="groups"
              :index-ready="Boolean(currentIndex)"
              :index-unavailable="indexStatus === 'unavailable'"
              :quickbar="quickbar"
              :selected-id="selectedId"
              @select="selectType($event.id, $event)"
              @remove-item="removeSavedItem"
              @import="importSavedQuickbar"
              @export="exportSavedQuickbar"
              @clear="clearQuickbar"
            />
          </template>
        </UiTabs>
      </aside>
      <div class="market-catalogue-page__detail">
        <template v-if="selectedId">
          <output
            v-if="!selectedItem && !itemQuery.error.value && itemQuery.data.value?.item !== null"
          >
            Loading selected item
          </output>
          <output v-else-if="itemQuery.error.value && !selectedItem">
            Selected market item is unavailable
          </output>
          <output v-else-if="itemQuery.data.value?.item === null && !selectedItem">
            This item is no longer available in the Market catalogue.
          </output>
          <template v-if="selectedItem">
            <div class="market-catalogue-page__detail-heading">
              <span class="market-catalogue-page__item-frame">
                <img
                  v-if="selectedImage"
                  class="market-catalogue-page__item-icon"
                  :src="selectedImage.source"
                  :srcset="selectedImage.sourceSet"
                  alt=""
                  width="48"
                  height="48"
                  loading="eager"
                  decoding="async"
                />
              </span>
              <div class="market-catalogue-page__item-identity">
                <p v-if="selectedPath.length" class="market-catalogue-page__path">
                  {{ selectedPath.join(' / ') }}
                </p>
                <h2>{{ selectedItem.name }}</h2>
                <output v-if="itemQuery.error.value"
                  >Item lookup is unavailable; showing the last loaded identity.</output
                >
              </div>
              <div class="market-catalogue-page__item-actions">
                <div
                  v-if="!selectedIsGlobalPlex || !profile"
                  class="market-catalogue-page__market-choice"
                >
                  <output v-if="profilesQuery.error.value && eligibleProfiles.length"
                    >Supported markets could not be refreshed; showing the last loaded
                    profiles.</output
                  >
                  <label
                    v-if="eligibleProfiles.length"
                    class="market-catalogue-page__market-select"
                  >
                    <span aria-hidden="true">Market</span>
                    <select
                      id="market-public-profile"
                      aria-label="Supported market"
                      :value="profile?.profileId"
                      @change="selectProfile"
                    >
                      <option
                        v-for="option in eligibleProfiles"
                        :key="option.profileId"
                        :value="option.profileId"
                      >
                        {{ marketProfileLabel(option.regionId, option.mode) }}
                      </option>
                    </select>
                  </label>
                  <output v-else-if="profilesQuery.asyncStatus.value === 'loading'"
                    >Loading supported markets</output
                  >
                  <output v-else-if="profilesQuery.error.value"
                    >Supported markets are unavailable</output
                  >
                  <output v-else-if="profiles.length"
                    >No supported public market is configured for this item.</output
                  >
                  <output v-else
                    >No public market is configured. Item browsing remains available.</output
                  >
                </div>
                <button
                  class="market-catalogue-page__quickbar-button"
                  type="button"
                  :aria-label="selectedIsPinned ? 'Remove from Quickbar' : 'Add to Quickbar'"
                  :aria-pressed="selectedIsPinned"
                  :disabled="!canPinSelected"
                  @click="pinSelectedItem"
                >
                  <MarketQuickbarPinIcon :filled="selectedIsPinned" />
                  <span>{{ selectedIsPinned ? 'Unpin' : 'Pin' }}</span>
                </button>
              </div>
            </div>
            <output class="sr-only" aria-live="polite"
              >Selected item {{ selectedItem?.name ?? selectedId
              }}{{ selectedGroup ? ` in ${selectedGroup.name}` : '' }}.</output
            >
            <MarketBookSummary v-if="book && book.status !== 'uncollected'" :book="book" />
            <UiTabs
              v-model="detailTab"
              class="market-catalogue-page__detail-tabs"
              aria-label="Market item details"
              :tabs="detailTabs"
              :unmount-on-hide="true"
            >
              <template #data>
                <output v-if="orderPresentation.loading && !book && profile">
                  Loading market orders
                </output>
                <output v-else-if="orderPresentation.unavailable && !book && profile">
                  Market order source is unavailable
                </output>
                <template v-if="book">
                  <output v-if="orderPresentation.retained"
                    >Order source is unavailable; showing the last loaded coverage and
                    observation.</output
                  >
                  <output v-if="book.status === 'uncollected'"
                    >No complete order observation has been collected for this item and
                    market.</output
                  >
                  <template v-else>
                    <output v-if="bookState.coverage === 'observed-empty'">
                      No orders in this ESI regional observation.
                    </output>
                    <MarketOrderTables :key="orderVersion" :book="book" @restart="orders.restart" />
                  </template>
                </template>
              </template>
              <template #history>
                <div class="market-catalogue-page__history">
                  <UiStatePanel
                    v-if="historyNotice"
                    compact
                    class="market-catalogue-page__history-state"
                    :role="historyNotice === 'unavailable' ? 'alert' : 'status'"
                  >
                    <template v-if="historyNoticeCopy[historyNotice].busy" #icon>
                      <div class="app-scanner" aria-hidden="true" />
                    </template>
                    <p>{{ historyNoticeCopy[historyNotice].title }}</p>
                    <p
                      v-if="historyNoticeCopy[historyNotice].detail"
                      class="market-catalogue-page__history-detail"
                    >
                      {{ historyNoticeCopy[historyNotice].detail }}
                    </p>
                    <template v-if="historyNoticeCopy[historyNotice].action" #action>
                      <button
                        type="button"
                        class="market-catalogue-page__history-action"
                        @click="retryHistoryRequest"
                      >
                        {{ historyNoticeCopy[historyNotice].action }}
                      </button>
                    </template>
                  </UiStatePanel>
                  <output v-else-if="historyQuery.error.value && !history && profile">
                    Daily price history is unavailable for this market item.
                  </output>
                  <output v-if="history && historyQuery.error.value"
                    >History source is unavailable; showing the last loaded daily data.</output
                  >
                  <MarketPriceHistory v-if="history && !historyNotice" :history="history" />
                </div>
              </template>
            </UiTabs>
          </template>
        </template>
        <div v-else class="market-catalogue-page__placeholder">
          <h2>Select an item</h2>
          <p>Use the category browser or search to explore a market item.</p>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.market-catalogue-page {
  min-width: 0;
  color: var(--ui-text);
}
.market-catalogue-page__header {
  margin-bottom: 1.5rem;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 1.25rem;
}
.market-catalogue-page__icon {
  width: 4.5rem;
  height: 4.5rem;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 0.0625rem solid color-mix(in srgb, var(--ui-primary) 40%, transparent);
}
.market-catalogue-page__icon .app-icon {
  width: 100%;
  height: 100%;
}
.market-catalogue-page__header .ui-eyebrow {
  font-size: 0.75rem;
}
.market-catalogue-page__header h1 {
  margin: 0;
  font-size: clamp(1.375rem, 2vw, 1.875rem);
  font-weight: 300;
  line-height: 0.95;
  letter-spacing: -0.045em;
  overflow-wrap: anywhere;
}
@media (max-width: 32.5rem) {
  .market-catalogue-page__header {
    gap: 0.875rem;
  }
}
.market-catalogue-page > output {
  display: block;
  margin-bottom: 0.625rem;
  color: var(--ui-text-muted);
  font-size: 0.8125rem;
}
.market-catalogue-page__workspace {
  display: grid;
  grid-template-columns: minmax(13.75rem, 17rem) minmax(0, 1fr);
  gap: 0.875rem;
  align-items: start;
  min-width: 0;
}
.market-catalogue-page__browse {
  position: sticky;
  top: 1rem;
  min-width: 0;
  min-height: 0;
  max-height: calc(100dvh - 7rem);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--ui-border);
  background: var(--ui-surface);
}
.market-catalogue-page__browse :deep(.ui-tabs) {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.market-catalogue-page__browse :deep(.ui-tabs-list),
.market-catalogue-page__detail :deep(.ui-tabs-list) {
  flex: 0 0 auto;
  gap: 0;
  padding: 0;
}
.market-catalogue-page__browse :deep(.ui-tabs-trigger) {
  flex: 1;
}
.market-catalogue-page :deep(.ui-tabs-trigger) {
  min-height: 2.375rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4375rem;
  padding: 0 1rem;
  border-bottom: 0;
  color: var(--ui-text-muted);
  font: 500 0.625rem/1 var(--ui-font-mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.market-catalogue-page :deep(.ui-tabs-trigger:hover),
.market-catalogue-page :deep(.ui-tabs-trigger[data-state='active']) {
  color: var(--ui-primary);
}
.market-catalogue-page__browse :deep(.ui-tabs-content[data-state='active']) {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.625rem 0.375rem;
}
.market-catalogue-page__browse
  :deep(.ui-tabs-content[data-state='active']:has(> .market-quickbar-panel)) {
  padding: 0;
}
.market-catalogue-page__search-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0 0.25rem;
}
.market-catalogue-page__search {
  min-width: 0;
  height: 2rem;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.625rem;
  border: 1px solid var(--ui-border-strong);
  background: var(--ui-control);
}
.market-catalogue-page__search:focus-within {
  border-color: var(--ui-primary);
}
.market-catalogue-page__search > svg {
  width: 0.875rem;
  height: 0.875rem;
  flex: 0 0 0.875rem;
  fill: none;
  stroke: var(--ui-text-muted);
  stroke-width: 1.8;
}
.market-catalogue-page__search input {
  min-width: 0;
  width: 100%;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ui-text);
  font: 0.875rem/1 var(--ui-font-body);
}
.market-catalogue-page__search input::placeholder {
  color: var(--ui-text-faint);
}
.market-catalogue-page__collapse {
  width: 2rem;
  height: 2rem;
  flex: 0 0 2rem;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--ui-border);
  background: transparent;
  color: var(--ui-text-muted);
  cursor: pointer;
}
.market-catalogue-page__collapse:hover {
  border-color: color-mix(in srgb, var(--ui-primary) 45%, transparent);
  color: var(--ui-primary);
}
.market-catalogue-page__collapse svg {
  width: 0.9375rem;
  height: 0.9375rem;
  fill: currentColor;
}
.market-catalogue-page__results {
  min-width: 0;
  overflow-y: auto;
  scrollbar-color: color-mix(in srgb, var(--ui-primary) 30%, transparent) transparent;
  scrollbar-width: thin;
}
.market-catalogue-page__results > output {
  display: block;
  margin: 0;
  padding: 0.75rem 0.5rem;
  color: var(--ui-text-muted);
  font-size: 0.8125rem;
}
.market-catalogue-page__results ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.market-catalogue-page__results li {
  display: flex;
  align-items: center;
  min-width: 0;
}
.market-catalogue-page__results li:hover,
.market-catalogue-page__results li:focus-within {
  background: color-mix(in srgb, var(--ui-primary) 8%, transparent);
}
.market-catalogue-page__result-select {
  position: relative;
  flex: 1;
  min-width: 0;
  padding: 0.4375rem 0.625rem;
  border: 0;
  background: transparent;
  color: var(--ui-text);
  font: 0.875rem/1.2 var(--ui-font-body);
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.market-catalogue-page__result-select[aria-current] {
  background: color-mix(in srgb, var(--ui-primary) 12%, transparent);
  box-shadow: inset 2px 0 0 var(--ui-primary);
}
.market-catalogue-page__result-pin {
  width: 1.5rem;
  min-height: 1.5rem;
  flex: 0 0 1.5rem;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ui-text-muted);
  opacity: 0;
  cursor: pointer;
}
.market-catalogue-page__results li:hover .market-catalogue-page__result-pin,
.market-catalogue-page__results li:focus-within .market-catalogue-page__result-pin,
.market-catalogue-page__result-pin--pinned {
  opacity: 1;
}
.market-catalogue-page__result-pin--pinned,
.market-catalogue-page__result-pin:hover,
.market-catalogue-page__result-pin:focus-visible {
  color: var(--ui-primary);
}
.market-catalogue-page__result-pin:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
@media (hover: none) {
  .market-catalogue-page__result-pin {
    opacity: 1;
  }
}
.market-catalogue-page__detail {
  min-width: 0;
  border: 1px solid var(--ui-border);
  background: var(--ui-surface);
  overflow: clip;
}
.market-catalogue-page__detail > output,
.market-catalogue-page__detail :deep(.ui-tabs-content) > output,
.market-catalogue-page__detail :deep(.ui-tabs-content) > p {
  display: block;
  margin: 0;
  padding: 0.75rem 1.125rem;
  color: var(--ui-text-muted);
  font-size: 0.8125rem;
}
.market-catalogue-page__detail-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 0.875rem;
  min-width: 0;
  padding: 1rem 1.125rem 0.875rem;
  border-bottom: 1px solid var(--ui-border);
}
.market-catalogue-page__item-frame {
  position: relative;
  width: 3rem;
  height: 3rem;
  flex: 0 0 3rem;
  display: block;
  border: 1px solid var(--ui-border-strong);
  background: var(--ui-surface-solid);
  overflow: hidden;
}
.market-catalogue-page__item-icon {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.market-catalogue-page__item-identity {
  min-width: 0;
  flex: 1 1 12.5rem;
  display: grid;
  gap: 0.3125rem;
}
.market-catalogue-page__path {
  margin: 0;
  color: var(--ui-primary);
  font: 700 0.5625rem/1.3 var(--ui-font-mono);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  overflow-wrap: anywhere;
}
.market-catalogue-page__detail-heading h2 {
  min-width: 0;
  margin: 0;
  font-size: 1.625rem;
  font-weight: 300;
  line-height: 1.05;
  letter-spacing: -0.02em;
  overflow-wrap: anywhere;
}
.market-catalogue-page__item-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-left: auto;
}
.market-catalogue-page__market-choice {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  color: var(--ui-text-muted);
  font-size: 0.8125rem;
}
.market-catalogue-page__market-select {
  max-width: 100%;
  height: 2rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.625rem;
  border: 1px solid var(--ui-border-strong);
  background: var(--ui-control);
}
.market-catalogue-page__market-select:focus-within {
  border-color: var(--ui-primary);
}
.market-catalogue-page__market-select span {
  font: 700 0.5625rem/1 var(--ui-font-mono);
  letter-spacing: 0.13em;
  text-transform: uppercase;
}
.market-catalogue-page__market-select select {
  min-width: 0;
  max-width: 100%;
  padding-inline-end: 1.75rem;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ui-text);
  font: 0.875rem/1 var(--ui-font-body);
  cursor: pointer;
}
.market-catalogue-page__market-choice option {
  background: var(--ui-surface-solid);
  color: var(--ui-text);
}
.market-catalogue-page__quickbar-button {
  height: 2rem;
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 0.375rem;
  padding: 0 0.625rem;
  border: 1px solid var(--ui-border-strong);
  background: transparent;
  color: var(--ui-text-muted);
  font: 700 0.5625rem/1 var(--ui-font-mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  white-space: nowrap;
  cursor: pointer;
}
.market-catalogue-page__quickbar-button:hover:not(:disabled),
.market-catalogue-page__quickbar-button[aria-pressed='true'] {
  border-color: color-mix(in srgb, var(--ui-primary) 45%, transparent);
  color: var(--ui-primary);
}
.market-catalogue-page__quickbar-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.market-catalogue-page__quickbar-button svg {
  width: 0.875rem;
  height: 0.875rem;
  flex: 0 0 0.875rem;
}
.market-catalogue-page__detail-tabs :deep(.ui-tabs-list) {
  gap: 1.25rem;
  padding: 0 1.125rem;
}
.market-catalogue-page__detail-tabs :deep(.ui-tabs-trigger) {
  padding: 0;
}
.market-catalogue-page__detail-tabs :deep(.ui-tabs-content) {
  min-height: 0;
}
.market-catalogue-page__history {
  display: grid;
  gap: 0.75rem;
  padding: 1rem 1.125rem;
}
.market-catalogue-page__history > output {
  color: var(--ui-text-muted);
  font-size: 0.8125rem;
}
.market-catalogue-page__history-state {
  gap: 0.625rem;
  text-align: center;
}
.market-catalogue-page__history-state p {
  max-width: 28rem;
  margin: 0;
  line-height: 1.5;
}
.market-catalogue-page__history-detail {
  font: 0.8125rem/1.5 var(--ui-font-body);
  letter-spacing: 0;
}
.market-catalogue-page__history-action {
  margin-top: 0.5rem;
  height: 2rem;
  padding: 0 0.75rem;
  border: 1px solid var(--ui-border-strong);
  background: transparent;
  color: var(--ui-text);
  font: 700 0.5625rem/1 var(--ui-font-mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  cursor: pointer;
}
.market-catalogue-page__history-action:hover {
  border-color: var(--ui-primary);
  color: var(--ui-primary);
}
.market-catalogue-page__placeholder {
  padding: 2.5rem 1.5rem;
  text-align: center;
}
.market-catalogue-page__placeholder h2 {
  margin: 0 0 0.5rem;
  font-size: 1.625rem;
  font-weight: 300;
  letter-spacing: -0.02em;
}
.market-catalogue-page__placeholder p {
  margin: 0;
  color: var(--ui-text-muted);
  font-size: 0.875rem;
}
.market-catalogue-page :focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}
@media (max-width: 48rem) {
  .market-catalogue-page__workspace {
    grid-template-columns: minmax(0, 1fr);
  }
  .market-catalogue-page__browse {
    position: static;
    max-height: 45dvh;
  }
}
@media (max-width: 36rem) {
  .market-catalogue-page__detail-heading {
    padding: 0.875rem 1rem 0.75rem;
  }
  .market-catalogue-page__item-actions {
    margin-left: 0;
  }
}
</style>
