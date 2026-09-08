<script setup lang="ts">
import {
  ContextMenuContent,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from 'reka-ui'

const {
  label,
  accessibleLabel = label,
  description,
} = defineProps<{
  accessibleLabel?: string
  description?: string
  label: string
}>()
</script>

<template>
  <ContextMenuRoot>
    <ContextMenuTrigger as-child>
      <slot name="trigger" />
    </ContextMenuTrigger>

    <ContextMenuPortal defer>
      <ContextMenuContent
        class="ui-context-menu"
        :aria-label="accessibleLabel ?? label"
        :collision-padding="8"
      >
        <ContextMenuLabel class="ui-context-menu-label">
          <strong>{{ label }}</strong>
          <span v-if="description">{{ description }}</span>
        </ContextMenuLabel>
        <ContextMenuSeparator class="ui-context-menu-separator" />
        <slot />
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>
