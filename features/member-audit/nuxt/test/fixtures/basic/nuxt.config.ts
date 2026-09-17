import platform from '@eve-space/platform-module-nuxt'
import { defineNuxtConfig } from 'nuxt/config'

export default defineNuxtConfig({
  modules: [
    [
      platform,
      {
        contributions: [
          {
            moduleId: 'member-audit',
            defaultIcon: 'corporation',
            queryAdmissionScopes: [],
            navigation: [],
            pages: [],
          },
        ],
      },
    ],
  ],
})
