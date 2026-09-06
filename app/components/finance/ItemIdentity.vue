<script setup lang="ts">
defineProps<{
  name: string
  typeId: number
}>()

defineEmits<{
  'open-item': [typeId: number]
}>()
</script>

<template>
  <EveItemInformationPopover :type-id="typeId">
    <template #trigger>
      <button
        class="finance-item-identity"
        type="button"
        :aria-label="`View item information for ${name}`"
        @click="$emit('open-item', typeId)"
      >
        {{ name }}
      </button>
    </template>
  </EveItemInformationPopover>
</template>
