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
            packageName: '@eve-space/member-audit-nuxt',
            defaultIcon: 'corporation',
            reviewerContributions: [],
            queryAdmissionScopes: [],
            navigation: [],
            pages: [],
          },
        ],
      },
    ],
  ],
})
