import { defineNuxtModule } from '@nuxt/kit'
import type { NuxtModule } from '@nuxt/schema'

export default defineNuxtModule({
  meta: {
    compatibility: { nuxt: '>=4.5.2 <5' },
    name: '@eve-space/member-audit-nuxt',
  },
}) as NuxtModule
