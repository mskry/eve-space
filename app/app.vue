<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'

const siteUrl = 'https://eve-space.com'
const siteTitle = 'EVE Space // Capsuleer Operations'
const siteDescription =
  'Secure EVE Online operations for character identity, skills, mail, wallets, markets, contracts, and corporations.'
const socialImage = `${siteUrl}/social-card.png`
const route = useRoute()
const canonicalUrl = computed(() => new URL(route.path, siteUrl).toString())

useHead(() => ({
  link: [{ rel: 'canonical', href: canonicalUrl.value }],
}))

useSeoMeta({
  description: siteDescription,
  ogTitle: siteTitle,
  ogDescription: siteDescription,
  ogType: 'website',
  ogUrl: () => canonicalUrl.value,
  ogSiteName: 'EVE Space',
  ogLocale: 'en_US',
  ogImage: socialImage,
  ogImageWidth: 1200,
  ogImageHeight: 630,
  ogImageType: 'image/png',
  ogImageAlt: 'EVE Space capsuleer operations deck',
  twitterCard: 'summary_large_image',
  twitterTitle: siteTitle,
  twitterDescription: siteDescription,
  twitterImage: socialImage,
  twitterImageAlt: 'EVE Space capsuleer operations deck',
})

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
