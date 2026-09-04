<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'reka-ui'

defineProps<{
  description?: string
  label: string
}>()
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child>
      <slot name="trigger" />
    </DropdownMenuTrigger>

    <DropdownMenuPortal defer>
      <DropdownMenuContent
        class="ui-dropdown-menu"
        align="end"
        :collision-padding="8"
        :side-offset="4"
      >
        <DropdownMenuLabel class="ui-dropdown-menu-label">
          <strong>{{ label }}</strong>
          <span v-if="description">{{ description }}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator class="ui-dropdown-menu-separator" />
        <slot />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
