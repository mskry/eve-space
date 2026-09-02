<script setup lang="ts">
import {
  PopoverArrow,
  PopoverClose,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
} from 'reka-ui'

defineOptions({ inheritAttrs: false })

withDefaults(
  defineProps<{
    align?: 'center' | 'end' | 'start'
    arrow?: boolean
    closeLabel?: string
    collisionPadding?: number
    side?: 'bottom' | 'left' | 'right' | 'top'
    sideOffset?: number
  }>(),
  {
    align: 'center',
    arrow: true,
    closeLabel: 'Close popover',
    collisionPadding: 12,
    side: 'bottom',
    sideOffset: 8,
  },
)

const open = defineModel<boolean>('open', { default: false })
const trigger = ref<{ $el?: Element } | HTMLElement | null>(null)

function updateOpen(value: boolean) {
  open.value = value
  if (value) return

  void nextTick(() => {
    const triggerElement = trigger.value instanceof HTMLElement ? trigger.value : trigger.value?.$el
    if (triggerElement instanceof HTMLElement) triggerElement.focus()
  })
}
</script>

<template>
  <PopoverRoot :open="open" @update:open="updateOpen">
    <PopoverTrigger ref="trigger" as-child>
      <slot name="trigger" />
    </PopoverTrigger>

    <PopoverPortal defer>
      <PopoverContent
        class="ui-popover"
        :align="align"
        :collision-padding="collisionPadding"
        :side="side"
        :side-offset="sideOffset"
        v-bind="$attrs"
      >
        <PopoverClose class="ui-popover-close" type="button" :aria-label="closeLabel">
          <slot name="close"><span aria-hidden="true">X</span></slot>
        </PopoverClose>
        <slot />
        <PopoverArrow v-if="arrow" class="ui-popover-arrow" :width="10" :height="5" />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
