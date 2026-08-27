import platformNuxtModule from '@eve-space/platform-module-nuxt'
import { installedNuxtModules } from './generated/platform/installed-nuxt-modules'
import { installedNuxtContributions } from './generated/platform/installed-nuxt-contributions'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
    },
  },
  css: [
    '~/assets/css/foundation.css',
    '~/assets/css/shell/public.css',
    '~/assets/css/shell/brand.css',
    '~/assets/css/shared/public-content.css',
    '~/assets/css/shared/async-state.css',
    '~/assets/css/shared/search-status.css',
    '~/assets/css/shared/wallet-state.css',
    '~/assets/css/pages/dashboard-overview.css',
    '~/assets/css/responsive.css',
    '~/assets/css/responsive/reduced-motion.css',
  ],
  devtools: {
    enabled: true,

    timeline: {
      enabled: true,
    },
  },
  modules: [
    [platformNuxtModule, { contributions: installedNuxtContributions }],
    ...installedNuxtModules,
  ],
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE || 'http://localhost:8788',
      eveImageBase: process.env.NUXT_PUBLIC_EVE_IMAGE_BASE || 'https://images.evetech.net',
    },
  },
  typescript: {
    typeCheck: true,
  },
})
