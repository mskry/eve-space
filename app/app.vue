<script setup lang="ts">
import { useQueryCache } from '@pinia/colada'
import { computed, defineAsyncComponent } from 'vue'
import {
  providePlatformIdentity,
  providePlatformQueryPersistence,
} from '@eve-space/platform-module-nuxt/runtime'
import { invalidatePrivateQueryScope, readQueryPersistenceState } from './query-persistence/runtime'

providePlatformIdentity(usePlatformHostIdentity)
const queryCache = useQueryCache()
providePlatformQueryPersistence((key) => readQueryPersistenceState(queryCache, key))
usePlatformModulePersistenceLifecycle(({ admissionScopes }) => {
  for (const admissionScope of admissionScopes) {
    void invalidatePrivateQueryScope(queryCache, { admissionScope, kind: 'organization' })
  }
})

const siteUrl = 'https://eve-space.com'
const siteTitle = 'EVE Space // Capsuleer Operations'
const siteDescription =
  'Secure EVE Online operations for character identity, skills, mail, wallets, markets, contracts, and corporations.'
const socialImage = `${siteUrl}/social-card.png`
const apiOrigin = new URL(useRuntimeConfig().public.apiBase).origin
const route = useRoute()
const canonicalUrl = computed(() => new URL(route.path, siteUrl).toString())

useHead(() => ({
  link: [
    { href: canonicalUrl.value, rel: 'canonical' },
    { crossorigin: 'use-credentials', href: apiOrigin, rel: 'preconnect' },
    { href: 'https://images.evetech.net', rel: 'preconnect' },
  ],
}))

useSeoMeta({
  description: siteDescription,
  ogDescription: siteDescription,
  ogImage: socialImage,
  ogImageAlt: 'EVE Space capsuleer operations deck',
  ogImageHeight: 630,
  ogImageType: 'image/png',
  ogImageWidth: 1200,
  ogLocale: 'en_US',
  ogSiteName: 'EVE Space',
  ogTitle: siteTitle,
  ogType: 'website',
  ogUrl: () => canonicalUrl.value,
  twitterCard: 'summary_large_image',
  twitterDescription: siteDescription,
  twitterImage: socialImage,
  twitterImageAlt: 'EVE Space capsuleer operations deck',
  twitterTitle: siteTitle,
})

const coladaDevtools = import.meta.dev
  ? defineAsyncComponent(() =>
      import('@pinia/colada-devtools').then((module) => module.PiniaColadaDevtools),
    )
  : undefined
</script>

<template>
  <UiProvider>
    <a class="app-skip-link" href="#main-content">Skip to main content</a>
    <NuxtRouteAnnouncer />
    <NuxtAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UiProvider>

  <component :is="coladaDevtools" v-if="coladaDevtools" />
</template>
