<script setup lang="ts">
import type { ToolbarRootProps } from 'reka-ui'
import { ToolbarRoot } from 'reka-ui'

withDefaults(
  defineProps<{
    label: string
    orientation?: ToolbarRootProps['orientation']
    loop?: boolean
  }>(),
  {
    orientation: 'horizontal',
    loop: true,
  },
)
</script>

<template>
  <ToolbarRoot class="ui-toolbar" :aria-label="label" :orientation="orientation" :loop="loop">
    <slot />
  </ToolbarRoot>
</template>
