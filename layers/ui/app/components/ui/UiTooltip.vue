<script setup lang="ts">
import { TooltipArrow, TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui'

withDefaults(
  defineProps<{
    content?: string
    disabled?: boolean
    side?: 'top' | 'right' | 'bottom' | 'left'
    arrow?: boolean
    open?: boolean
    reference?: { getBoundingClientRect: () => DOMRect; contextElement?: Element }
    delayDuration?: number
    contentClass?: string
  }>(),
  {
    arrow: true,
    content: '',
    disabled: false,
    open: undefined,
    side: 'top',
  },
)

const emit = defineEmits<{ 'update:open': [open: boolean] }>()
</script>

<template>
  <TooltipRoot
    :disabled="disabled"
    :open="open"
    :delay-duration="delayDuration"
    @update:open="emit('update:open', $event)"
  >
    <TooltipTrigger as-child :reference="reference">
      <slot />
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent
        class="ui-tooltip-content"
        :class="contentClass"
        :side="side"
        :side-offset="10"
      >
        <slot name="content">{{ content }}</slot>
        <TooltipArrow v-if="arrow" class="ui-tooltip-arrow" :width="8" :height="4" />
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
