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

withDefaults(
  defineProps<{
    description?: string
    title: string
  }>(),
  {
    description: 'Application navigation',
  },
)

const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <div class="ui-drawer-root">
    <DrawerRoot v-model:open="open" swipe-direction="left">
      <DrawerTrigger as-child>
        <slot name="trigger" />
      </DrawerTrigger>

      <DrawerPortal defer>
        <DrawerOverlay class="ui-drawer-overlay" />
        <DrawerContent class="ui-drawer-content">
          <VisuallyHidden>
            <DrawerTitle>{{ title }}</DrawerTitle>
            <DrawerDescription>{{ description }}</DrawerDescription>
          </VisuallyHidden>
          <DrawerClose class="ui-drawer-close" aria-label="Close navigation">
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
