import { fileURLToPath } from 'node:url'
import { defineNuxtConfig } from 'nuxt/config'
import alphaNuxtModule from './modules/alpha-nuxt/src/module.js'
import platformNuxtModule from '../../../src/module.js'

const alphaPackageRoot = fileURLToPath(new URL('./modules/alpha-nuxt', import.meta.url))
const betaPackageRoot = fileURLToPath(new URL('./modules/beta-nuxt', import.meta.url))
const platformRuntimeEntry = fileURLToPath(new URL('../../../src/runtime.ts', import.meta.url))
const platformRuntime = fileURLToPath(new URL('../../../src/runtime', import.meta.url))
const alphaReviewerPanel = `${alphaPackageRoot}/src/runtime/reviewer/overview.vue`
const betaReviewerPanel = `${betaPackageRoot}/src/runtime/reviewer/details.vue`

export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? '',
      eveImageBase: 'https://images.evetech.net',
    },
  },
  alias: {
    '@eve-space/alpha-nuxt/reviewer/overview': alphaReviewerPanel,
    '@eve-space/alpha-nuxt': `${alphaPackageRoot}/src/module.js`,
    '@eve-space/beta-nuxt/reviewer/details': betaReviewerPanel,
    '@eve-space/beta-nuxt': `${betaPackageRoot}/src/module.js`,
    '@eve-space/platform-module-nuxt/runtime': platformRuntimeEntry,
    '@eve-space/platform-module-nuxt/runtime/platform-api': `${platformRuntime}/platform-api.ts`,
    '@eve-space/platform-module-nuxt/runtime/reviewer-panel': `${platformRuntime}/reviewer-panel.ts`,
  },
  modules: [
    [
      platformNuxtModule,
      {
        contributions: [
          {
            moduleId: 'alpha',
            packageName: '@eve-space/alpha-nuxt',
            defaultIcon: 'character',
            sections: [],
            reviewerContributions: [
              {
                contributionId: 'overview',
                routeId: 'alpha-summary',
                routePath: '/api/modules/alpha/summary',
                audience: 'hr',
                requiredPermission: 'alpha.review',
                target: 'managed-organization-account',
                panelExport: './reviewer/overview',
                label: 'Alpha review',
                description: 'Review an alpha member.',
                icon: 'overview',
                order: 10,
              },
            ],
            queryAdmissionScopes: [
              {
                routeId: 'alpha-summary',
                admissionScope: 'organization:v1:alpha:member:alpha.view',
                authorization: 'authenticated-session',
                audience: 'member',
                requiredPermission: 'alpha.view',
              },
              {
                routeId: 'alpha-record',
                admissionScope: 'organization:v1:alpha:member:alpha.view',
                authorization: 'owned-character',
                audience: 'member',
                requiredPermission: 'alpha.view',
              },
            ],
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
                icon: 'settings',
                audience: 'public',
                placement: 'dashboard',
                order: 50,
                pageName: 'eve-alpha-record',
              },
            ],
          },
          {
            moduleId: 'beta',
            packageName: '@eve-space/beta-nuxt',
            defaultIcon: 'settings',
            sections: [],
            reviewerContributions: [
              {
                contributionId: 'details',
                routeId: 'beta-details',
                routePath: '/api/modules/beta/details',
                audience: 'director',
                requiredPermission: 'beta.review',
                target: 'managed-organization-character',
                panelExport: './reviewer/details',
                label: 'Beta details',
                description: 'Review beta character details.',
                icon: 'settings',
                order: 20,
              },
            ],
            queryAdmissionScopes: [
              {
                routeId: 'beta-details',
                admissionScope: 'organization:v1:beta:director:beta.review',
                authorization: 'authenticated-session',
                audience: 'director',
                requiredPermission: 'beta.review',
                target: 'managed-organization-character',
              },
            ],
            pages: [],
            navigation: [],
          },
        ],
      },
    ],
    alphaNuxtModule,
  ],
})
