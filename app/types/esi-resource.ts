import type { PlatformResourceState } from '@eve-space/platform-module-nuxt/runtime'

export type EsiResourceState = Exclude<PlatformResourceState, { status: 'stale' | 'unavailable' }>
