<script setup lang="ts">
import type { AssetRecord } from '../../types/assets'
import { assetImageKind, isSkinAsset } from '../../utils/assets-hierarchy'

const props = defineProps<{
  asset: AssetRecord
}>()

const emit = defineEmits<{
  activate: [asset: AssetRecord]
}>()

const open = ref(false)
const identityLabel = computed(() => props.asset.customName || props.asset.typeName)
const imageKind = computed(() => assetImageKind(props.asset))
const imageSource = computed(() => (isSkinAsset(props.asset) ? '/images/eve-skin.png' : undefined))

function updateOpen(value: boolean) {
  open.value = value
  if (value) emit('activate', props.asset)
}

function openInformation() {
  updateOpen(true)
}

defineExpose({ openInformation })
</script>

<template>
  <EveItemInformationPopover
    :open="open"
    :image-kind="imageKind"
    :image-source="imageSource"
    :type-id="asset.typeId"
    @update:open="updateOpen"
  >
    <template #trigger>
      <button
        class="assets-item-information-trigger"
        type="button"
        :aria-label="`View item information for ${identityLabel}`"
      >
        <span class="assets-item-information-type">{{ asset.typeName }}</span>
        <AppInformationIcon />
      </button>
    </template>
  </EveItemInformationPopover>
</template>

<style scoped>
.assets-item-information-trigger {
  min-width: 0;
  max-width: 100%;
  padding: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border: 0;
  color: var(--ui-text);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.assets-item-information-trigger:hover {
  color: var(--ui-primary-hover);
}

.assets-item-information-trigger:focus-visible {
  outline: 0.125rem solid var(--ui-primary);
  outline-offset: 0.2rem;
}

.assets-item-information-type {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
