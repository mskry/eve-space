export const platformReservedModuleIds = ['core', 'platform'] as const

const platformModuleIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const platformModuleIdMaxLength = 44
const platformContributionIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const platformExportNamePattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const platformMigrationFilenamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*\.sql$/
const platformPermissionKeyPattern = /^[a-z][a-z0-9.:-]*$/
const platformPermissionKeyMaxLength = 200
const platformPersistenceOperationIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const platformPersistenceOperationIdMaxLength = 54

declare const platformModuleIdBrand: unique symbol
declare const platformContributionIdBrand: unique symbol
declare const platformExportNameBrand: unique symbol
declare const platformMigrationFilenameBrand: unique symbol
declare const platformPermissionKeyBrand: unique symbol
declare const platformPersistenceOperationIdBrand: unique symbol

export type PlatformModuleId = string & { readonly [platformModuleIdBrand]: true }
export type PlatformContributionId = string & { readonly [platformContributionIdBrand]: true }
export type PlatformExportName = string & { readonly [platformExportNameBrand]: true }
export type PlatformMigrationFilename = string & {
  readonly [platformMigrationFilenameBrand]: true
}
export type PlatformPermissionKey = string & { readonly [platformPermissionKeyBrand]: true }
export type PlatformPersistenceOperationId = string & {
  readonly [platformPersistenceOperationIdBrand]: true
}

export type PlatformModuleIdIssue = 'syntax' | 'too-long' | 'reserved'
export type PlatformPersistenceOperationIdIssue = 'syntax' | 'too-long'

export function isReservedPlatformModuleId(moduleId: string) {
  return (platformReservedModuleIds as readonly string[]).includes(moduleId.toLowerCase())
}

export function isPlatformModuleId(value: string) {
  return platformModuleIdIssues(value).length === 0
}

export function platformModuleIdIssues(value: string): readonly PlatformModuleIdIssue[] {
  const issues: PlatformModuleIdIssue[] = []
  if (!platformModuleIdPattern.test(value)) issues.push('syntax')
  if (value.length > platformModuleIdMaxLength) issues.push('too-long')
  if (isReservedPlatformModuleId(value)) issues.push('reserved')
  return issues
}

export function isPlatformContributionId(value: string) {
  return platformContributionIdPattern.test(value)
}

export function isPlatformExportName(value: string) {
  return platformExportNamePattern.test(value)
}

export function isPlatformMigrationFilename(value: string) {
  return platformMigrationFilenamePattern.test(value)
}

export function isPlatformPermissionKey(value: string) {
  return (
    value.length <= platformPermissionKeyMaxLength &&
    platformPermissionKeyPattern.test(value) &&
    value.split(/[.:]/).every((segment) => segment.length > 0 && !segment.endsWith('-'))
  )
}

export function isPlatformPersistenceOperationId(value: string) {
  return platformPersistenceOperationIdIssues(value).length === 0
}

export function platformPersistenceOperationIdIssues(
  value: string,
): readonly PlatformPersistenceOperationIdIssue[] {
  const issues: PlatformPersistenceOperationIdIssue[] = []
  if (!platformPersistenceOperationIdPattern.test(value)) issues.push('syntax')
  if (value.length > platformPersistenceOperationIdMaxLength) issues.push('too-long')
  return issues
}

export function parsePlatformModuleId(value: string): PlatformModuleId {
  if (!isPlatformModuleId(value)) throw new Error(`Invalid platform module ID ${value}`)
  return value as PlatformModuleId
}

export function parsePlatformContributionId(value: string): PlatformContributionId {
  if (!isPlatformContributionId(value)) throw new Error(`Invalid platform contribution ID ${value}`)
  return value as PlatformContributionId
}

export function parsePlatformExportName(value: string): PlatformExportName {
  if (!isPlatformExportName(value)) throw new Error(`Invalid platform export name ${value}`)
  return value as PlatformExportName
}

export function parsePlatformMigrationFilename(value: string): PlatformMigrationFilename {
  if (!isPlatformMigrationFilename(value))
    throw new Error(`Invalid platform migration filename ${value}`)
  return value as PlatformMigrationFilename
}

export function parsePlatformPermissionKey(value: string): PlatformPermissionKey {
  if (!isPlatformPermissionKey(value)) throw new Error(`Invalid platform permission key ${value}`)
  return value as PlatformPermissionKey
}

export function parsePlatformPersistenceOperationId(value: string): PlatformPersistenceOperationId {
  if (!isPlatformPersistenceOperationId(value))
    throw new Error(`Invalid platform persistence operation ID ${value}`)
  return value as PlatformPersistenceOperationId
}
