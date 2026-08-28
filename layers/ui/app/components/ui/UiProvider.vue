<script setup lang="ts">
import { ConfigProvider, ToastProvider, ToastViewport, TooltipProvider } from 'reka-ui'
</script>

<template>
  <ConfigProvider>
    <TooltipProvider :delay-duration="350" :skip-delay-duration="150">
      <ToastProvider>
        <slot />
        <ToastViewport class="ui-toast-viewport" />
      </ToastProvider>
    </TooltipProvider>
  </ConfigProvider>
</template>
