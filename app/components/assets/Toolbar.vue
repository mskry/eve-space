<script setup lang="ts">
import type { AssetFilterState } from '../../types/assets'
import { EMPTY_ASSET_FILTERS } from '../../utils/assets-filter'

interface AssetsFilterOption<T extends string | number> {
  label: string
  value: T
}

const props = defineProps<{
  categoryOptions: readonly AssetsFilterOption<number>[]
  filters: AssetFilterState
  flagOptions: readonly AssetsFilterOption<string>[]
  groupOptions: readonly AssetsFilterOption<number>[]
  locationOptions: readonly AssetsFilterOption<string>[]
  matchCount: number
  sortOptions: readonly { label: string; value: string }[]
  sourceCount: number
  typeOptions: readonly AssetsFilterOption<number>[]
}>()

const emit = defineEmits<{
  change: [filters: AssetFilterState]
}>()

const sort = defineModel<string>('sort', { required: true })

const singletonOptions = [
  { value: 'all', label: 'Any' },
  { value: 'yes', label: 'Unique item' },
  { value: 'no', label: 'Stackable' },
] as const
const blueprintOptions = [
  { value: 'all', label: 'Any' },
  { value: 'copy', label: 'BPC' },
  { value: 'original', label: 'BPO' },
  { value: 'unknown', label: 'Unknown' },
] as const

const filtersOpen = ref(false)
const selectedType = filterModel(
  () => props.filters.typeIds[0],
  () => props.typeOptions,
  (typeIds) => emit('change', { ...props.filters, typeIds }),
)
const selectedGroup = filterModel(
  () => props.filters.groupIds[0],
  () => props.groupOptions,
  (groupIds) => emit('change', { ...props.filters, groupIds }),
)
const selectedCategory = filterModel(
  () => props.filters.categoryIds[0],
  () => props.categoryOptions,
  (categoryIds) => emit('change', { ...props.filters, categoryIds }),
)
const selectedLocation = filterModel(
  () => props.filters.locationKeys[0],
  () => props.locationOptions,
  (locationKeys) => emit('change', { ...props.filters, locationKeys }),
)
const selectedFlag = filterModel(
  () => props.filters.flags[0],
  () => props.flagOptions,
  (flags) => emit('change', { ...props.filters, flags }),
)
const selectedSingleton = computed<string>({
  get: () => props.filters.singleton,
  set: (value) =>
    emit('change', { ...props.filters, singleton: value as AssetFilterState['singleton'] }),
})
const selectedBlueprint = computed<string>({
  get: () => props.filters.blueprint,
  set: (value) =>
    emit('change', { ...props.filters, blueprint: value as AssetFilterState['blueprint'] }),
})
const typeAutocompleteOptions = computed(() =>
  autocompleteOptions(props.typeOptions, props.filters.typeIds[0]),
)
const groupAutocompleteOptions = computed(() =>
  autocompleteOptions(props.groupOptions, props.filters.groupIds[0]),
)
const categoryAutocompleteOptions = computed(() =>
  autocompleteOptions(props.categoryOptions, props.filters.categoryIds[0]),
)
const locationAutocompleteOptions = computed(() =>
  autocompleteOptions(props.locationOptions, props.filters.locationKeys[0]),
)
const flagAutocompleteOptions = computed(() =>
  autocompleteOptions(props.flagOptions, props.filters.flags[0]),
)

const showType = computed(() => props.typeOptions.length > 1 || props.filters.typeIds.length > 0)
const showGroup = computed(() => props.groupOptions.length > 1 || props.filters.groupIds.length > 0)
const showCategory = computed(
  () => props.categoryOptions.length > 1 || props.filters.categoryIds.length > 0,
)
const showLocation = computed(
  () => props.locationOptions.length > 1 || props.filters.locationKeys.length > 0,
)
const showFlag = computed(() => props.flagOptions.length > 1 || props.filters.flags.length > 0)

const activeChips = computed(() => {
  const chips: { facet: string; key: keyof AssetFilterState; label: string }[] = []
  if (props.filters.typeIds[0] !== undefined)
    chips.push({
      facet: 'Type',
      key: 'typeIds',
      label: named(props.typeOptions, props.filters.typeIds[0]),
    })
  if (props.filters.groupIds[0] !== undefined)
    chips.push({
      facet: 'Group',
      key: 'groupIds',
      label: named(props.groupOptions, props.filters.groupIds[0]),
    })
  if (props.filters.categoryIds[0] !== undefined)
    chips.push({
      facet: 'Category',
      key: 'categoryIds',
      label: named(props.categoryOptions, props.filters.categoryIds[0]),
    })
  if (props.filters.locationKeys[0] !== undefined)
    chips.push({
      facet: 'Location',
      key: 'locationKeys',
      label: named(props.locationOptions, props.filters.locationKeys[0]),
    })
  if (props.filters.flags[0] !== undefined)
    chips.push({
      facet: 'Placement',
      key: 'flags',
      label: named(props.flagOptions, props.filters.flags[0]),
    })
  if (props.filters.singleton !== 'all')
    chips.push({
      facet: 'Item state',
      key: 'singleton',
      label: singletonOptions.find((option) => option.value === props.filters.singleton)!.label,
    })
  if (props.filters.blueprint !== 'all')
    chips.push({
      facet: 'Blueprint',
      key: 'blueprint',
      label: blueprintOptions.find((option) => option.value === props.filters.blueprint)!.label,
    })
  return chips
})
const activeCount = computed(
  () => activeChips.value.length + (props.filters.search.trim() === '' ? 0 : 1),
)

function named(options: readonly AssetsFilterOption<string | number>[], value: string | number) {
  return options.find((option) => option.value === value)?.label ?? `${String(value) || 'Unknown'}`
}

function changeSearch(event: Event) {
  emit('change', { ...props.filters, search: (event.target as HTMLInputElement).value })
}

function clearSearch() {
  emit('change', { ...props.filters, search: '' })
}

function clearChip(key: keyof AssetFilterState) {
  if (key === 'singleton') emit('change', { ...props.filters, singleton: 'all' })
  else if (key === 'blueprint') emit('change', { ...props.filters, blueprint: 'all' })
  else emit('change', { ...props.filters, [key]: [] })
}

function clearAll() {
  emit('change', { ...EMPTY_ASSET_FILTERS })
}

function filterModel<T extends string | number>(
  getSelected: () => T | undefined,
  getOptions: () => readonly AssetsFilterOption<T>[],
  update: (selected: readonly T[]) => void,
) {
  const labelFor = (selected: T | undefined) => {
    if (selected === undefined) return ''
    const options = getOptions()
    return (
      options.find((option) => option.value === selected)?.label ??
      unavailableOption(selected).label
    )
  }
  const draft = ref(labelFor(getSelected()))
  // Clearing a facet from its chip or Clear all updates the parent, not this draft.
  watch(getSelected, (selected) => {
    draft.value = labelFor(selected)
  })
  return computed<string>({
    get: () => draft.value,
    set: (value) => {
      draft.value = value
      const option = getOptions().find((entry) => entry.label === value)
      if (option || value === '') update(option ? [option.value] : [])
    },
  })
}

function unavailableOption<T extends string | number>(value: T): AssetsFilterOption<T> {
  return { value, label: `${String(value) || 'Unknown'} (unavailable)` }
}

function autocompleteOptions<T extends string | number>(
  options: readonly AssetsFilterOption<T>[],
  selected?: T,
) {
  const available = options.map((option) => option.label)
  return selected !== undefined && !options.some((option) => option.value === selected)
    ? [...available, unavailableOption(selected).label]
    : available
}
</script>

<template>
  <section class="assets-toolbar" aria-labelledby="assets-toolbar-title">
    <h2 id="assets-toolbar-title" class="sr-only">Inventory search and filters</h2>

    <div class="assets-strip">
      <div class="assets-strip-field assets-strip-field--sort">
        <span aria-hidden="true">Sort by</span>
        <UiSelect v-model="sort" label="Sort by" :options="sortOptions" placeholder="Name" />
      </div>

      <div class="assets-strip-field assets-strip-field--search">
        <label for="assets-search">Search text</label>
        <div class="assets-strip-search">
          <input
            id="assets-search"
            class="ui-input"
            type="search"
            autocomplete="off"
            :value="filters.search"
            placeholder="Type, custom name, location, group, category, flag..."
            @input="changeSearch"
          />
          <button
            v-if="filters.search !== ''"
            class="assets-strip-clear"
            type="button"
            aria-label="Clear search text"
            @click="clearSearch"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      </div>

      <button
        class="assets-strip-filters"
        type="button"
        :aria-expanded="filtersOpen"
        aria-controls="assets-filter-drawer"
        @click="filtersOpen = !filtersOpen"
      >
        FILTERS
        <span v-if="activeCount > 0" class="assets-strip-count">{{ activeCount }}</span>
      </button>
    </div>

    <div
      v-if="filtersOpen"
      id="assets-filter-drawer"
      class="assets-filters"
      aria-label="Inventory filters"
    >
      <div v-if="showType" class="assets-filter-control">
        <span>Type</span>
        <UiAutocomplete
          v-model="selectedType"
          input-id="assets-type-filter"
          label="Type filter"
          :options="typeAutocompleteOptions"
          placeholder="All types"
        />
      </div>
      <div v-if="showGroup" class="assets-filter-control">
        <span>Group</span>
        <UiAutocomplete
          v-model="selectedGroup"
          input-id="assets-group-filter"
          label="Group filter"
          :options="groupAutocompleteOptions"
          placeholder="All groups"
        />
      </div>
      <div v-if="showCategory" class="assets-filter-control">
        <span>Category</span>
        <UiAutocomplete
          v-model="selectedCategory"
          input-id="assets-category-filter"
          label="Category filter"
          :options="categoryAutocompleteOptions"
          placeholder="All categories"
        />
      </div>
      <div v-if="showLocation" class="assets-filter-control">
        <span>Location</span>
        <UiAutocomplete
          v-model="selectedLocation"
          input-id="assets-location-filter"
          label="Location filter"
          :options="locationAutocompleteOptions"
          placeholder="All locations"
        />
      </div>
      <div v-if="showFlag" class="assets-filter-control">
        <span>Placement flag</span>
        <UiAutocomplete
          v-model="selectedFlag"
          input-id="assets-flag-filter"
          label="Placement flag filter"
          :options="flagAutocompleteOptions"
          placeholder="All flags"
        />
      </div>
      <div class="assets-filter-toggle">
        <span>Item state</span>
        <UiToggleGroup
          v-model="selectedSingleton"
          label="Item state filter"
          :options="singletonOptions"
        />
      </div>
      <div class="assets-filter-toggle">
        <span>Blueprint</span>
        <UiToggleGroup
          v-model="selectedBlueprint"
          label="Blueprint filter"
          :options="blueprintOptions"
        />
      </div>
    </div>

    <div class="assets-chips">
      <span v-if="activeChips.length > 0" class="assets-chips-label">Active</span>
      <button
        v-for="chip in activeChips"
        :key="chip.facet"
        class="assets-chip"
        type="button"
        :aria-label="`Clear ${chip.facet} filter`"
        @click="clearChip(chip.key)"
      >
        <b>{{ chip.facet }}</b> {{ chip.label }} <span aria-hidden="true">✕</span>
      </button>
      <output class="assets-chips-count" aria-live="polite">
        {{ matchCount.toLocaleString('en-US') }} matches /
        {{ sourceCount.toLocaleString('en-US') }} assets
      </output>
      <button v-if="activeCount > 0" class="assets-chips-clear" type="button" @click="clearAll">
        Clear all
      </button>
    </div>
  </section>
</template>

<style scoped>
.assets-toolbar {
  min-width: 0;
  border-inline: 0.0625rem solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-surface-solid) 90%, transparent);
}

.assets-strip {
  min-width: 0;
  padding: 0.75rem 1.125rem;
  display: flex;
  align-items: flex-end;
  gap: 0.75rem;
  border-bottom: 0.0625rem solid var(--ui-border);
}

.assets-strip-field {
  min-width: 0;
  display: grid;
  gap: 0.375rem;
}

.assets-strip-field--sort {
  width: 10.5rem;
  flex: 0 0 10.5rem;
}

.assets-strip-field--search {
  flex: 1 1 auto;
}

.assets-strip-field > label,
.assets-strip-field > span,
.assets-filter-control > span,
.assets-filter-toggle > span {
  color: var(--ui-text-subtle);
  font: 700 var(--character-meta-size) / 1 var(--ui-font-mono);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.assets-strip-search {
  position: relative;
  display: flex;
}

.assets-strip-search .ui-input {
  height: 2rem;
  padding: 0.5rem 2.25rem 0.5rem 0.625rem;
}

.assets-strip-clear {
  position: absolute;
  inset: 0.0625rem 0.0625rem 0.0625rem auto;
  width: 1.875rem;
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: var(--ui-text-subtle);
  font: 400 0.8rem/1 var(--ui-font-mono);
  cursor: pointer;
}

.assets-strip-clear:hover,
.assets-strip-clear:focus-visible {
  color: var(--ui-primary);
}

.assets-strip-filters {
  height: var(--character-compact-row-height);
  flex: 0 0 auto;
  padding: 0 0.875rem;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  border: 0.0625rem solid var(--ui-border-strong);
  background: transparent;
  color: var(--ui-text-muted);
  font: 800 var(--character-meta-size) / 1 var(--ui-font-mono);
  letter-spacing: 0.1em;
  cursor: pointer;
}

.assets-strip-filters:hover,
.assets-strip-filters[aria-expanded='true'] {
  border-color: var(--ui-primary);
  color: var(--ui-primary);
}

.assets-strip-filters:focus-visible {
  outline: 0.125rem solid var(--ui-primary);
  outline-offset: 0.125rem;
}

.assets-strip-count {
  color: var(--ui-primary);
  font: 700 0.56rem/1 var(--ui-font-mono);
}

.assets-filters {
  min-width: 0;
  padding: 0.875rem 1.125rem;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  gap: 0.625rem 0.75rem;
  border-bottom: 0.0625rem solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-surface-raised) 42%, transparent);
}

.assets-filter-control,
.assets-filter-toggle {
  min-width: 0;
  display: grid;
  gap: 0.35rem;
  align-content: start;
}

.assets-filter-toggle :deep(.ui-toggle-group) {
  width: max-content;
  max-width: 100%;
}

.assets-chips {
  min-width: 0;
  padding: 0.56rem 1.125rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.44rem;
  border-bottom: 0.0625rem solid var(--ui-border);
}

.assets-chips-label {
  color: var(--ui-text-faint);
  font: 700 0.5rem/1 var(--ui-font-mono);
  letter-spacing: 0.11em;
  text-transform: uppercase;
}

.assets-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.44rem;
  padding: 0.31rem 0.5rem;
  border: 0.0625rem solid color-mix(in srgb, var(--ui-primary) 34%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-primary) 8%, transparent);
  color: var(--ui-primary);
  font: 700 0.56rem/1 var(--ui-font-mono);
  letter-spacing: 0.05em;
  cursor: pointer;
}

.assets-chip:hover,
.assets-chip:focus-visible {
  border-color: var(--ui-primary);
}

.assets-chip b {
  color: var(--ui-text-subtle);
}

.assets-chips-count {
  margin-left: auto;
  color: var(--ui-text-subtle);
  font: 700 0.56rem/1 var(--ui-font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.assets-chips-clear {
  border: 0;
  background: transparent;
  color: var(--ui-text-subtle);
  font: 700 0.56rem/1 var(--ui-font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
}

.assets-chips-clear:hover,
.assets-chips-clear:focus-visible {
  color: var(--ui-primary);
}

@media (max-width: 44rem) {
  .assets-strip {
    flex-wrap: wrap;
  }

  .assets-strip-field--sort {
    flex: 1 1 8rem;
    width: auto;
  }

  .assets-strip-field--search {
    flex: 1 1 100%;
    order: -1;
  }
}
</style>
