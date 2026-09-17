import type { PlatformModuleSectionContribution } from './server.js'

export interface PlatformInstalledModuleDefinition {
  readonly moduleId: string
  readonly defaultEnabled: boolean
}

export type PlatformInstalledModuleSectionDefinition = PlatformModuleSectionContribution & {
  readonly moduleId: string
}

export interface PlatformInstalledOrganizationAdmissionScopeDescriptor {
  readonly moduleId: string
  readonly admissionScope: string
  readonly audience: 'member' | 'hr' | 'director'
  readonly requiredPermission: string
  readonly additionalRequiredPermissions?: readonly string[]
}

export interface PlatformInstalledModuleMigrationDescriptor {
  readonly moduleId: string
  readonly name: string
}
