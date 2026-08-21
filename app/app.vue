<script setup lang="ts">
import { defineAsyncComponent } from 'vue'

const coladaDevtools = import.meta.dev
  ? defineAsyncComponent(() =>
      import('@pinia/colada-devtools').then((module) => module.PiniaColadaDevtools),
    )
  : undefined
</script>

<template>
  <UiProvider>
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UiProvider>

  <component :is="coladaDevtools" v-if="coladaDevtools" />
</template>
