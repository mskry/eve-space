import type {
  PlatformIconToken,
  PlatformNavigationAudience,
  PlatformNavigationPlacement,
} from '@eve-space/platform-module-contract'

export interface PlatformNavigationIdentity {
  readonly ownerId: string
  readonly navigationId: string
}

export interface PlatformNavigationEntry extends PlatformNavigationIdentity {
  readonly label: string
  readonly description: string
  readonly to: string
  readonly icon: PlatformIconToken
  readonly audience: PlatformNavigationAudience
  readonly placement: PlatformNavigationPlacement
  readonly order: number
}

export interface PlatformPageMetadata {
  readonly moduleId: string
  readonly pageName: string
  readonly audience: PlatformNavigationAudience
}
