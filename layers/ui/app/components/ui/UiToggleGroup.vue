<script setup lang="ts">
import { ToggleGroupItem, ToggleGroupRoot } from 'reka-ui'

export interface UiToggleGroupOption {
  disabled?: boolean
  label: string
  value: string
}

const props = withDefaults(
  defineProps<{
    disabled?: boolean
    itemClass?: string
    label: string
    loop?: boolean
    options: readonly UiToggleGroupOption[]
  }>(),
  {
    disabled: false,
    itemClass: undefined,
    loop: true,
  },
)

defineSlots<{
  option?: (props: { option: UiToggleGroupOption; selected: boolean }) => unknown
}>()

const modelValue = defineModel<string>({ required: true })

function updateModelValue(value: unknown) {
  if (
    typeof value === 'string' &&
    value !== modelValue.value &&
    props.options.some((option) => option.value === value && !option.disabled)
  ) {
    modelValue.value = value
  }
}
</script>

<template>
  <ToggleGroupRoot
    class="ui-toggle-group"
    :aria-label="label"
    :disabled="disabled"
    :loop="loop"
    :model-value="modelValue"
    orientation="horizontal"
    type="single"
    @update:model-value="updateModelValue"
  >
    <ToggleGroupItem
      v-for="option in options"
      :key="option.value"
      :class="['ui-toggle-group-item', itemClass]"
      :aria-label="option.label"
      :disabled="option.disabled"
      :value="option.value"
    >
      <slot name="option" :option="option" :selected="modelValue === option.value">
        {{ option.label }}
      </slot>
    </ToggleGroupItem>
  </ToggleGroupRoot>
</template>
