<script setup lang="ts">
interface EveItemInformationItem {
  category: { id: number; name: string }
  description: string | null
  detail: unknown
  group: { id: number; name: string }
  name: string
  typeId: number
}

const props = withDefaults(
  defineProps<{
    descriptionId?: string
    detailsLabel?: string
    imageKind?: 'type-bp' | 'type-bpc' | 'type-icon'
    imageSource?: string
    item?: EveItemInformationItem
    status: 'loaded' | 'loading' | 'unavailable'
    titleId?: string
  }>(),
  {
    descriptionId: undefined,
    detailsLabel: undefined,
    imageKind: 'type-icon',
    imageSource: undefined,
    item: undefined,
    titleId: undefined,
  },
)

defineSlots<{
  details(props: { item: EveItemInformationItem }): unknown
}>()

const emit = defineEmits<{
  retry: []
}>()

const sectionTabs = computed(() => [
  { label: 'Description', value: 'description' },
  { label: props.detailsLabel ?? 'Details', value: 'details' },
])

function itemClassification(item: EveItemInformationItem) {
  return item.category.name === 'Skill'
    ? item.group.name
    : `${item.category.name} / ${item.group.name}`
}
</script>

<template>
  <article class="eve-item-information-content">
    <output v-if="status === 'loading'" class="eve-item-information-state">
      <span class="app-scanner" aria-hidden="true" />
      <span :id="titleId" class="eve-item-information-state-title">Item information</span>
      <span :id="descriptionId">Loading item information...</span>
    </output>

    <div v-else-if="status === 'loaded' && item" class="eve-item-information-loaded">
      <header class="eve-item-information-header">
        <img
          v-if="imageSource"
          class="eve-item-information-image"
          :src="imageSource"
          alt=""
          width="64"
          height="64"
        />
        <UiEveImage v-else :kind="imageKind" :id="item.typeId" :dimension="64" alt="" />
        <div>
          <h2 :id="titleId">{{ item.name }}</h2>
          <p class="ui-eyebrow">{{ itemClassification(item) }}</p>
        </div>
      </header>

      <UiTabs
        v-if="detailsLabel"
        aria-label="Item information sections"
        default-value="description"
        :tabs="sectionTabs"
      >
        <template #description>
          <UiScrollArea class="eve-item-information-scroll">
            <section class="eve-item-information-description" aria-label="Description">
              <p v-if="item.description" :id="descriptionId">{{ item.description }}</p>
              <p v-else :id="descriptionId" class="eve-item-information-empty">
                No description is available for this item.
              </p>
            </section>
          </UiScrollArea>
        </template>
        <template #details>
          <UiScrollArea class="eve-item-information-scroll">
            <slot name="details" :item="item" />
          </UiScrollArea>
        </template>
      </UiTabs>

      <template v-else>
        <UiScrollArea class="eve-item-information-scroll">
          <section class="eve-item-information-description is-standalone" aria-label="Description">
            <p v-if="item.description" :id="descriptionId">{{ item.description }}</p>
            <p v-else :id="descriptionId" class="eve-item-information-empty">
              No description is available for this item.
            </p>
          </section>
        </UiScrollArea>

        <slot name="details" :item="item" />
      </template>
    </div>

    <div v-else class="eve-item-information-state" role="alert">
      <span class="ui-eyebrow">ERR / ITEM DETAIL</span>
      <h2 :id="titleId">Item information unavailable</h2>
      <p :id="descriptionId">The static item record could not be loaded.</p>
      <button class="ui-action-secondary" type="button" @click="emit('retry')">RETRY UPLINK</button>
    </div>
  </article>
</template>

<style scoped>
.eve-item-information-content {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
}

.eve-item-information-loaded {
  display: grid;
}

.eve-item-information-header {
  min-height: 86px;
  padding: 12px 42px 12px 12px;
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--ui-border);
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--ui-text) 3%, transparent),
    transparent 72%
  );
}

.eve-item-information-header :deep(.ui-eve-image),
.eve-item-information-image {
  width: 58px;
  height: 58px;
  display: block;
  border: 1px solid color-mix(in srgb, var(--ui-warning) 46%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-surface-solid) 80%, transparent);
  box-shadow: inset 0 0 18px color-mix(in srgb, var(--ui-warning) 5%, transparent);
  object-fit: contain;
}

.eve-item-information-header h2,
.eve-item-information-state h2,
.eve-item-information-state-title {
  margin: 0;
  color: var(--ui-text);
  font: 500 15px/1.2 var(--ui-font-body);
  letter-spacing: 0.015em;
}

.eve-item-information-state-title {
  display: block;
}

.eve-item-information-header .ui-eyebrow {
  margin-top: 5px;
  color: var(--ui-text-muted);
  font-size: 9px;
  letter-spacing: 0.06em;
}

.eve-item-information-description {
  padding: 14px 12px;
}

.eve-item-information-scroll {
  max-height: min(20rem, calc(100dvh - 14rem));
}

.eve-item-information-description.is-standalone::before {
  content: 'Description';
  width: max-content;
  margin: -14px 0 12px;
  padding: 9px 2px 7px;
  display: block;
  border-bottom: 2px solid var(--ui-warning);
  color: var(--ui-text);
  font: 500 10px/1 var(--ui-font-body);
  letter-spacing: 0.02em;
}

.eve-item-information-description p,
.eve-item-information-state p,
.eve-item-information-state > span:last-child {
  margin: 0;
  color: color-mix(in srgb, var(--ui-text) 82%, var(--ui-text-muted));
  font: 400 11px/1.5 var(--ui-font-body);
  white-space: pre-line;
}

.eve-item-information-empty {
  font-style: italic;
}

.eve-item-information-state {
  min-height: 190px;
  padding: 22px;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 12px;
  text-align: center;
}

.eve-item-information-state .ui-action-secondary {
  margin-top: 4px;
}

@media (max-width: 420px) {
  .eve-item-information-header {
    grid-template-columns: 52px minmax(0, 1fr);
  }

  .eve-item-information-header :deep(.ui-eve-image),
  .eve-item-information-image {
    width: 52px;
    height: 52px;
  }
}
</style>
