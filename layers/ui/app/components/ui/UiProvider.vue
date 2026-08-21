<script setup lang="ts">
import { ConfigProvider, TooltipProvider } from 'reka-ui'
</script>

<template>
  <ConfigProvider>
    <TooltipProvider :delay-duration="350" :skip-delay-duration="150">
      <slot />
    </TooltipProvider>
  </ConfigProvider>
</template>
