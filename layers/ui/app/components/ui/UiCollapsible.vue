<script setup lang="ts">
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui'

withDefaults(
  defineProps<{
    defaultOpen?: boolean
    disabled?: boolean
  }>(),
  {
    defaultOpen: false,
    disabled: false,
  },
)
</script>

<template>
  <CollapsibleRoot :default-open="defaultOpen" :disabled="disabled">
    <CollapsibleTrigger as-child>
      <slot name="trigger" />
    </CollapsibleTrigger>
    <CollapsibleContent class="ui-collapsible-content">
      <slot />
    </CollapsibleContent>
  </CollapsibleRoot>
</template>
