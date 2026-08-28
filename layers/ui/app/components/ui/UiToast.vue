<script setup lang="ts">
import { ToastClose, ToastDescription, ToastRoot, ToastTitle } from 'reka-ui'

withDefaults(
  defineProps<{
    description?: string
    title: string
  }>(),
  {
    description: '',
  },
)

const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <ToastRoot v-model:open="open" class="ui-toast-root">
    <div class="ui-toast-content">
      <ToastTitle class="ui-toast-title">{{ title }}</ToastTitle>
      <ToastDescription v-if="description" class="ui-toast-description">
        {{ description }}
      </ToastDescription>
    </div>
    <ToastClose class="ui-toast-close">Dismiss</ToastClose>
  </ToastRoot>
</template>
