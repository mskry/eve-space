<script setup lang="ts">
import { TooltipArrow, TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from 'reka-ui'

withDefaults(
  defineProps<{
    content?: string
    disabled?: boolean
    side?: 'top' | 'right' | 'bottom' | 'left'
    arrow?: boolean
  }>(),
  {
    content: '',
    disabled: false,
    side: 'top',
    arrow: true,
  },
)
</script>

<template>
  <TooltipRoot :disabled="disabled">
    <TooltipTrigger as-child>
      <slot />
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent class="ui-tooltip-content" :side="side" :side-offset="10">
        <slot name="content">{{ content }}</slot>
        <TooltipArrow v-if="arrow" class="ui-tooltip-arrow" :width="8" :height="4" />
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
