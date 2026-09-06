<script setup lang="ts">
import {
  SelectContent,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from 'reka-ui'

export interface UiSelectOption {
  disabled?: boolean
  label: string
  value: string
}

const props = withDefaults(
  defineProps<{
    disabled?: boolean
    label: string
    options: readonly UiSelectOption[]
    placeholder?: string
  }>(),
  {
    disabled: false,
    placeholder: 'Select an option',
  },
)

const modelValue = defineModel<string>({ required: true })
const selectedLabel = computed(
  () => props.options.find((option) => option.value === modelValue.value)?.label,
)

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
  <SelectRoot :disabled="disabled" :model-value="modelValue" @update:model-value="updateModelValue">
    <SelectTrigger class="ui-select-trigger" type="button" :aria-label="label">
      <SelectValue :placeholder="placeholder">{{ selectedLabel }}</SelectValue>
      <SelectIcon class="ui-select-icon" aria-hidden="true">⌄</SelectIcon>
    </SelectTrigger>

    <SelectPortal defer>
      <SelectContent
        class="ui-select-content"
        position="popper"
        :collision-padding="8"
        :side-offset="4"
      >
        <SelectScrollUpButton class="ui-select-scroll-button" aria-label="Scroll options up">
          ↑
        </SelectScrollUpButton>
        <SelectViewport class="ui-select-viewport">
          <SelectItem
            v-for="option in options"
            :key="option.value"
            class="ui-select-item"
            :disabled="option.disabled"
            :text-value="option.label"
            :value="option.value"
          >
            <SelectItemIndicator class="ui-select-indicator" aria-hidden="true">
              ✓
            </SelectItemIndicator>
            <SelectItemText>{{ option.label }}</SelectItemText>
          </SelectItem>
        </SelectViewport>
        <SelectScrollDownButton class="ui-select-scroll-button" aria-label="Scroll options down">
          ↓
        </SelectScrollDownButton>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
