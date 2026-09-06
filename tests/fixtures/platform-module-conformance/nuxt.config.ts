import { fileURLToPath } from 'node:url'
import platformNuxtModule from '@eve-space/platform-module-nuxt'
import { defineNuxtConfig } from 'nuxt/config'
import conformanceNuxtModule from './features/conformance/nuxt/dist/module.js'
import { installedNuxtContributions } from './generated/platform/installed-nuxt-contributions.js'

const conformanceNuxtEntry = fileURLToPath(
  new URL('./features/conformance/nuxt/dist/module.js', import.meta.url),
)

export default defineNuxtConfig({
  ssr: true,
  alias: {
    '@eve-space/conformance-nuxt': conformanceNuxtEntry,
  },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? 'http://127.0.0.1:9',
      eveImageBase: 'https://images.evetech.net',
    },
  },
  modules: [
    [platformNuxtModule, { contributions: installedNuxtContributions }],
    conformanceNuxtModule,
  ],
})
