import type { PlatformOrganizationAudience } from './server.js'

export const platformPermissionSensitivities = ['standard', 'sensitive'] as const
export type PlatformPermissionSensitivity = (typeof platformPermissionSensitivities)[number]

export interface PlatformPermissionDeclaration {
  readonly key: string
  readonly label: string
  readonly purpose: string
  readonly audiences: readonly PlatformOrganizationAudience[]
  readonly sensitivity: PlatformPermissionSensitivity
  readonly reviewAllowed: boolean
}

export interface PlatformPermissionProfileDeclaration {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly audiences: readonly PlatformOrganizationAudience[]
  readonly permissions: readonly string[]
}
