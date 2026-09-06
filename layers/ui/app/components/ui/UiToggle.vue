<script setup lang="ts">
import { Toggle } from 'reka-ui'

withDefaults(
  defineProps<{
    disabled?: boolean
    label: string
  }>(),
  {
    disabled: false,
  },
)

const modelValue = defineModel<boolean>({ required: true })
</script>

<template>
  <Toggle
    v-model="modelValue"
    class="ui-toggle ui-toggle-group-item"
    :aria-label="label"
    :disabled="disabled"
  >
    <slot />
  </Toggle>
</template>
