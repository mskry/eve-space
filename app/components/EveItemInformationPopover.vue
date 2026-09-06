<script setup lang="ts">
import type { PublicTypeDetail } from '../queries/universe'

const props = defineProps<{
  detailsLabel?: string
  imageKind?: 'type-bp' | 'type-bpc' | 'type-icon'
  imageSource?: string
  typeId: number
}>()

defineSlots<{
  details(props: { item: PublicTypeDetail }): unknown
  trigger(): unknown
}>()

const open = defineModel<boolean>('open', { default: false })
const titleId = `${useId()}-title`
const descriptionId = `${useId()}-description`

function updateOpen(value: boolean) {
  open.value = value
}
</script>

<template>
  <UiPopover
    :open="open"
    class="eve-item-information-popover"
    align="start"
    close-label="Close item information"
    aria-label="Item information"
    :aria-labelledby="titleId"
    :aria-describedby="descriptionId"
    @update:open="updateOpen"
  >
    <template #trigger>
      <slot name="trigger" />
    </template>

    <div class="eve-item-information-popover-scroll">
      <EveItemInformationPopoverQuery
        v-if="open"
        :description-id="descriptionId"
        :details-label="props.detailsLabel"
        :image-kind="props.imageKind"
        :image-source="props.imageSource"
        :title-id="titleId"
        :type-id="props.typeId"
      >
        <template #details="{ item }">
          <slot name="details" :item="item" />
        </template>
      </EveItemInformationPopoverQuery>
    </div>
  </UiPopover>
</template>

<style>
.eve-item-information-popover {
  box-sizing: border-box;
  width: min(
    400px,
    calc(100vw - 16px),
    var(--reka-popover-content-available-width, calc(100vw - 16px))
  );
  max-width: calc(100vw - 24px);
  max-height: min(
    calc(100dvh - 24px),
    var(--reka-popover-content-available-height, calc(100dvh - 24px))
  );
  border-color: color-mix(in srgb, var(--ui-border-strong) 82%, transparent);
  border-radius: 2px;
  overflow: hidden;
  background: color-mix(in srgb, var(--ui-canvas) 94%, transparent);
  box-shadow:
    0 16px 36px color-mix(in srgb, var(--ui-shadow) 72%, transparent),
    inset 0 1px 0 color-mix(in srgb, var(--ui-text) 5%, transparent);
  backdrop-filter: blur(14px);
}

.eve-item-information-popover > .ui-popover-close {
  top: 7px;
  right: 7px;
  width: 26px;
  height: 26px;
  border-color: transparent;
  border-radius: 0;
  background: transparent;
  font-size: 10px;
}

.eve-item-information-popover > .ui-popover-close:hover,
.eve-item-information-popover > .ui-popover-close:focus-visible {
  border-color: var(--ui-border);
  background: color-mix(in srgb, var(--ui-text) 6%, transparent);
}

.eve-item-information-popover-scroll {
  box-sizing: border-box;
  max-height: min(
    560px,
    calc(100dvh - 24px),
    var(--reka-popover-content-available-height, calc(100dvh - 24px))
  );
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.eve-item-information-popover .ui-popover-arrow {
  fill: color-mix(in srgb, var(--ui-canvas) 94%, transparent);
}
</style>
