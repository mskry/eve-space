import { fileURLToPath } from 'node:url'
import { defineNuxtConfig } from 'nuxt/config'
import alphaNuxtModule from './modules/alpha-nuxt/src/module.js'
import platformNuxtModule from '../../../src/module.js'

const alphaPackageRoot = fileURLToPath(new URL('./modules/alpha-nuxt', import.meta.url))

export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? '',
    },
  },
  alias: {
    '@eve-space/alpha-nuxt': `${alphaPackageRoot}/src/module.js`,
  },
  modules: [
    [
      platformNuxtModule,
      {
        contributions: [
          {
            moduleId: 'alpha',
            defaultIcon: 'character',
            pages: [
              {
                id: 'alpha-record',
                name: 'eve-alpha-record',
                path: '/characters/:characterId/alpha',
                file: 'src/runtime/app/pages/alpha.vue',
                extensionPoint: 'character-shell',
                audience: 'authenticated',
              },
            ],
            navigation: [
              {
                id: 'alpha-default-icon',
                label: 'Alpha',
                description: 'Default module icon',
                to: '/characters/:characterId/alpha',
                audience: 'authenticated',
                placement: 'character',
                order: 50,
                pageName: 'eve-alpha-record',
              },
              {
                id: 'alpha-icon-override',
                label: 'Alpha override',
                description: 'Entry icon override',
                to: '/alpha',
                icon: 'status',
                audience: 'public',
                placement: 'dashboard',
                order: 50,
                pageName: 'eve-alpha-record',
              },
            ],
          },
        ],
      },
    ],
    alphaNuxtModule,
  ],
})
