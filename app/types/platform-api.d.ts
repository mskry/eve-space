import type { AppType } from '../../api/src/index'
// oxlint-disable-next-line import/no-unassigned-import -- Required for host contract augmentation.
import '@eve-space/platform-module-nuxt/runtime/platform-api'

declare module '@eve-space/platform-module-nuxt/runtime/platform-api' {
  interface PlatformApiHost {
    readonly app: AppType
  }
}
