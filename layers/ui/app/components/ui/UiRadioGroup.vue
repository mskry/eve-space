<script setup lang="ts">
import { RadioGroupIndicator, RadioGroupItem, RadioGroupRoot } from 'reka-ui'

export interface UiRadioGroupOption {
  label: string
  value: string
}

defineProps<{
  label: string
  disabled?: boolean
  options: readonly UiRadioGroupOption[]
}>()

const model = defineModel<string | undefined>({ default: undefined })
</script>

<template>
  <RadioGroupRoot
    v-model="model"
    class="ui-radio-group"
    :aria-label="label"
    :disabled="disabled"
    orientation="horizontal"
  >
    <RadioGroupItem
      v-for="option in options"
      :key="option.value"
      class="ui-radio-group-item"
      :aria-label="option.label"
      :value="option.value"
    >
      <slot name="option" :option="option" :checked="model === option.value">
        <span>{{ option.label }}</span>
      </slot>
      <RadioGroupIndicator class="ui-radio-group-indicator">
        <span aria-hidden="true">&#10003;</span>
      </RadioGroupIndicator>
    </RadioGroupItem>
  </RadioGroupRoot>
</template>
