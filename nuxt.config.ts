import platformNuxtModule from '@eve-space/platform-module-nuxt'
import { installedNuxtModules } from './generated/platform/installed-nuxt-modules'
import { installedNuxtContributions } from './generated/platform/installed-nuxt-contributions'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  app: {
    head: {
      title: 'EVE Space // Capsuleer Operations',
      htmlAttrs: { lang: 'en' },
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
      ],
      meta: [
        { name: 'theme-color', content: '#060b0f' },
        { name: 'application-name', content: 'EVE Space' },
        { name: 'apple-mobile-web-app-title', content: 'EVE Space' },
      ],
    },
  },
  css: [
    '~/assets/css/foundation.css',
    '~/assets/css/shell/public.css',
    '~/assets/css/shell/brand.css',
    '~/assets/css/shared/public-content.css',
    '~/assets/css/shared/async-state.css',
    '~/assets/css/shared/search-status.css',
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
