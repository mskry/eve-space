<script setup lang="ts">
import {
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerOverlay,
  DrawerPortal,
  DrawerRoot,
  DrawerTitle,
  DrawerTrigger,
  VisuallyHidden,
} from 'reka-ui'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    closeLabel?: string
    contentClass?: string
    description?: string
    restoreFocus?: boolean
    side?: 'left' | 'right'
    title: string
  }>(),
  {
    closeLabel: 'Close navigation',
    contentClass: undefined,
    description: 'Application navigation',
    restoreFocus: true,
    side: 'left',
  },
)

const open = defineModel<boolean>('open', { default: false })

function handleCloseAutoFocus(event: Event) {
  if (!props.restoreFocus) {
    event.preventDefault()
  }
}
</script>

<template>
  <div class="ui-drawer-root">
    <DrawerRoot v-model:open="open" :swipe-direction="side">
      <DrawerTrigger v-if="$slots.trigger" as-child>
        <slot name="trigger" />
      </DrawerTrigger>

      <DrawerPortal defer>
        <DrawerOverlay class="ui-drawer-overlay" />
        <DrawerContent
          aria-modal="true"
          :class="['ui-drawer-content', contentClass]"
          :data-side="side"
          @close-auto-focus="handleCloseAutoFocus"
        >
          <VisuallyHidden>
            <DrawerTitle>{{ title }}</DrawerTitle>
            <DrawerDescription>{{ description }}</DrawerDescription>
          </VisuallyHidden>
          <DrawerClose class="ui-drawer-close" :aria-label="closeLabel">
            <span aria-hidden="true">X</span>
          </DrawerClose>
          <slot />
        </DrawerContent>
      </DrawerPortal>
    </DrawerRoot>
  </div>
</template>

<style>
.ui-drawer-root {
  display: contents;
}
</style>
