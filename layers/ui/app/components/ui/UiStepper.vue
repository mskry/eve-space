<script setup lang="ts">
import {
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperRoot,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from 'reka-ui'

export interface UiStepperStep {
  disabled?: boolean
  title: string
  value: number
}

export type UiStepperState = 'active' | 'completed' | 'inactive'

const {
  label,
  linear = true,
  steps,
} = defineProps<{
  label: string
  linear?: boolean
  steps: readonly UiStepperStep[]
}>()

defineSlots<{
  description?: (props: { state: UiStepperState; step: UiStepperStep }) => unknown
  indicator?: (props: { state: UiStepperState; step: UiStepperStep }) => unknown
}>()

const modelValue = defineModel<number>({ required: true })

const stateDescriptions: Record<UiStepperState, string> = {
  active: 'In progress',
  completed: 'Complete',
  inactive: 'Locked',
}

function indicatorLabel(step: UiStepperStep, state: UiStepperState) {
  return state === 'completed' ? '✓' : String(step.value).padStart(2, '0')
}
</script>

<template>
  <StepperRoot
    v-model="modelValue"
    class="ui-stepper"
    :aria-label="label"
    :linear="linear"
    orientation="horizontal"
  >
    <StepperItem
      v-for="step in steps"
      :key="step.value"
      v-slot="{ state }"
      class="ui-stepper-item"
      :disabled="step.disabled"
      :step="step.value"
    >
      <StepperTrigger class="ui-stepper-trigger">
        <StepperIndicator class="ui-stepper-indicator">
          <slot name="indicator" :state="state" :step="step">
            {{ indicatorLabel(step, state) }}
          </slot>
        </StepperIndicator>
        <span class="ui-stepper-copy">
          <StepperTitle class="ui-stepper-title">{{ step.title }}</StepperTitle>
          <StepperDescription class="ui-stepper-description">
            <slot name="description" :state="state" :step="step">
              {{ stateDescriptions[state] }}
            </slot>
          </StepperDescription>
        </span>
      </StepperTrigger>
      <StepperSeparator class="ui-stepper-separator" decorative />
    </StepperItem>
  </StepperRoot>
</template>
