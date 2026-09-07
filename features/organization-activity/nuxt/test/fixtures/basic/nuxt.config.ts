import { defineNuxtConfig } from 'nuxt/config'
import { fileURLToPath } from 'node:url'
import platform from '@eve-space/platform-module-nuxt'

export default defineNuxtConfig({
  runtimeConfig: { public: { apiBase: 'http://localhost:8788' } },
  alias: {
    '@eve-space/organization-activity-nuxt': fileURLToPath(
      new URL('../../../src/module.ts', import.meta.url),
    ),
  },
  modules: [
    [
      platform,
      {
        contributions: [
          {
            moduleId: 'organization-activity',
            defaultIcon: 'corporation',
            navigation: [],
            pages: [
              {
                id: 'organization-activity-projects',
                name: 'eve-organization-activity-projects',
                path: '/projects',
                file: 'src/runtime/app/pages/OrganizationActivityProjectPage.vue',
                extensionPoint: 'root',
                audience: 'authenticated',
              },
              {
                id: 'organization-activity-jobs',
                name: 'eve-organization-activity-jobs',
                path: '/jobs',
                file: 'src/runtime/app/pages/OrganizationActivityJobPage.vue',
                extensionPoint: 'root',
                audience: 'authenticated',
              },
              {
                id: 'organization-activity-campaigns',
                name: 'eve-organization-activity-campaigns',
                path: '/campaigns',
                file: 'src/runtime/app/pages/OrganizationActivityCampaignPage.vue',
                extensionPoint: 'root',
                audience: 'authenticated',
              },
            ],
          },
        ],
      },
    ],
  ],
})
