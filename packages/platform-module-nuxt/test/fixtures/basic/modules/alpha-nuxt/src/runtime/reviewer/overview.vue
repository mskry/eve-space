<script setup lang="ts">
import type { PlatformReviewerPanelProps } from '@eve-space/platform-module-nuxt/runtime/reviewer-panel'

defineProps<PlatformReviewerPanelProps>()
</script>

<template>
  <section data-testid="alpha-reviewer-panel">
    <h2>Alpha reviewer panel</h2>
    <p>{{ target.userId }} at organization version {{ organizationVersion }}</p>
  </section>
</template>
