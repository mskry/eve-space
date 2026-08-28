<script setup lang="ts">
import { ToastClose, ToastDescription, ToastRoot, ToastTitle } from 'reka-ui'

withDefaults(
  defineProps<{
    actionHref?: string
    actionLabel?: string
    description?: string
    duration?: number
    title: string
  }>(),
  {
    actionHref: '',
    actionLabel: 'Open',
    description: '',
    duration: 5000,
  },
)

const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <ToastRoot v-model:open="open" class="ui-toast-root" :duration="duration">
    <div class="ui-toast-content">
      <ToastTitle class="ui-toast-title">{{ title }}</ToastTitle>
      <ToastDescription v-if="description" class="ui-toast-description">
        {{ description }}
      </ToastDescription>
      <a v-if="actionHref" class="ui-toast-action" :href="actionHref">{{ actionLabel }}</a>
    </div>
    <ToastClose class="ui-toast-close">Dismiss</ToastClose>
  </ToastRoot>
</template>
