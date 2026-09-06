import { defineNuxtModule } from '@nuxt/kit'
import type { NuxtModule } from '@nuxt/schema'

export default defineNuxtModule({
  meta: {
    name: '@eve-space/conformance-nuxt',
    compatibility: { nuxt: '>=4.5.2 <5' },
  },
}) as NuxtModule
