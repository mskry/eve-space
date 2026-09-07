import type { AppType } from '../../../../../../../../api/src/index.js'
// oxlint-disable-next-line import/no-unassigned-import -- Augments the actual host contract for the independent module fixture.
import '@eve-space/platform-module-nuxt/runtime/platform-api'

declare module '@eve-space/platform-module-nuxt/runtime/platform-api' {
  interface PlatformApiHost {
    readonly app: AppType
  }
}
