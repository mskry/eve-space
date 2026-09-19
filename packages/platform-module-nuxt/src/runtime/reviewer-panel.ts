import type { PlatformReviewerNuxtContribution } from '@eve-space/platform-module-contract/nuxt'
import type { Component } from 'vue'

export type PlatformReviewerSelectedTarget =
  | {
      readonly kind: 'managed-organization-account'
      readonly managedMemberLifecycleId: string
      readonly userId: string
      readonly sectionActivationVersion: number
    }
  | {
      readonly kind: 'managed-organization-character'
      readonly managedMemberLifecycleId: string
      readonly userId: string
      readonly characterId: number
      readonly characterLifecycleId: string
      readonly authorizationGeneration: number | null
      readonly disclosureVersion: number
      readonly sectionActivationVersion: number
    }

export interface PlatformReviewerPanelQueryAccess {
  readonly authenticated: boolean
  readonly authorized: boolean
  readonly moduleEnabled: boolean
}

export interface PlatformReviewerPanelProps {
  readonly moduleId: string
  readonly contributionId: string
  readonly routeId: string
  readonly sectionId?: string
  readonly organizationVersion: number
  readonly target: PlatformReviewerSelectedTarget
  readonly queryAccess: PlatformReviewerPanelQueryAccess
}

export type PlatformReviewerPanelComponent = Component<PlatformReviewerPanelProps>

export interface PlatformReviewerPanelModule {
  readonly default: PlatformReviewerPanelComponent
}

export type PlatformReviewerPanelLoader = () => Promise<PlatformReviewerPanelModule>

export interface PlatformReviewerPanelCatalogEntry extends PlatformReviewerNuxtContribution {
  readonly moduleId: string
  readonly load: PlatformReviewerPanelLoader
}
