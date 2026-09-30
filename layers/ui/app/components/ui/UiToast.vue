<script setup lang="ts">
import { ToastAction, ToastClose, ToastDescription, ToastRoot, ToastTitle } from 'reka-ui'

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
      <ToastAction v-if="actionHref" as-child :alt-text="actionLabel">
        <a class="ui-toast-action" :href="actionHref">{{ actionLabel }}</a>
      </ToastAction>
    </div>
    <ToastClose class="ui-toast-close">Dismiss</ToastClose>
  </ToastRoot>
</template>

<style src="../../assets/css/toast.css"></style>
