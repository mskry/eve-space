<script setup lang="ts">
defineProps<{
  name: string
  typeId: number
}>()
</script>

<template>
  <EveItemInformationPopover :type-id="typeId">
    <template #trigger>
      <button
        class="finance-item-identity"
        type="button"
        :aria-label="`View item information for ${name}`"
      >
        {{ name }}
      </button>
    </template>
  </EveItemInformationPopover>
</template>
