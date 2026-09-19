import { and, eq, inArray } from 'drizzle-orm'
import type {
  PlatformInstalledPermissionDescriptor,
  PlatformInstalledPermissionProfileDescriptor,
} from '@eve-space/platform-module-contract/installed'
import { db, type DatabaseTransaction } from '../db/client.js'
import { deploymentModules } from '../db/schema.js'
import {
  installedPermissionCatalog,
  installedPermissionProfileCatalog,
} from '../generated/platform/installed-permission-catalog.js'
import {
  createPermissionCatalogIndex,
  findCatalogPermission,
  findCatalogProfile,
  uniquePermissionSelections,
  type ModulePermissionSelection,
  type PermissionSelection,
} from './permission-catalog-policy.js'

const catalog = createPermissionCatalogIndex(
  installedPermissionCatalog,
  installedPermissionProfileCatalog,
)

type QueryExecutor = DatabaseTransaction | typeof db

interface StoredModulePermission extends ModulePermissionSelection {
  readonly reviewAllowed: boolean
}

interface StoredServicePermission {
  readonly type: 'service'
  readonly key: string
  readonly reviewAllowed: boolean
}

export type StoredPermission = StoredModulePermission | StoredServicePermission

export class OrganizationPermissionCatalogError extends Error {
  constructor(readonly code: 'permission-unavailable' | 'profile-unavailable') {
    super(code)
  }
}

export function currentCatalogPermission(
  identity: Pick<ModulePermissionSelection, 'publisherPackage' | 'moduleId' | 'key'>,
) {
  return findCatalogPermission(catalog, identity)
}

export async function resolveCurrentPermissionSelections(
  transaction: DatabaseTransaction,
  selections: readonly PermissionSelection[],
): Promise<readonly StoredPermission[]> {
  const unique = uniquePermissionSelections(selections)
  const moduleIds = [
    ...new Set(unique.flatMap((entry) => (entry.type === 'module' ? [entry.moduleId] : []))),
  ]
  const enabledModuleIds = await loadEnabledModuleIds(transaction, moduleIds)
  return unique.map((entry) => {
    if (entry.type === 'service')
      return { type: 'service', key: entry.key, reviewAllowed: Boolean(entry.reviewAllowed) }
    const declaration = findCatalogPermission(catalog, entry)
    if (!declaration || !enabledModuleIds.has(entry.moduleId))
      throw new OrganizationPermissionCatalogError('permission-unavailable')
    return {
      type: 'module',
      publisherPackage: entry.publisherPackage,
      moduleId: entry.moduleId,
      key: entry.key,
      reviewAllowed: declaration.reviewAllowed,
    }
  })
}

export async function listEnabledPermissionCatalog(executor: QueryExecutor = db) {
  const enabledModuleIds = await loadEnabledModuleIds(executor, [
    ...new Set(catalog.permissions.map(({ moduleId }) => moduleId)),
  ])
  return {
    permissions: catalog.permissions.filter(({ moduleId }) => enabledModuleIds.has(moduleId)),
    profiles: catalog.profiles.filter(({ moduleId }) => enabledModuleIds.has(moduleId)),
  } satisfies {
    permissions: readonly PlatformInstalledPermissionDescriptor[]
    profiles: readonly PlatformInstalledPermissionProfileDescriptor[]
  }
}

export async function previewEnabledPermissionProfile(input: {
  publisherPackage: string
  moduleId: string
  profileId: string
}) {
  const profile = findCatalogProfile(catalog, { ...input, id: input.profileId })
  const enabled = await loadEnabledModuleIds(db, [input.moduleId])
  if (!profile || !enabled.has(input.moduleId))
    throw new OrganizationPermissionCatalogError('profile-unavailable')
  const permissions = profile.permissions.map((key) => {
    const declaration = findCatalogPermission(catalog, { ...input, key })
    if (!declaration) throw new OrganizationPermissionCatalogError('profile-unavailable')
    return {
      input: {
        type: 'module' as const,
        publisherPackage: declaration.publisherPackage,
        moduleId: declaration.moduleId,
        key: declaration.key,
      },
      ...declaration,
    }
  })
  return { profile, permissions }
}

async function loadEnabledModuleIds(executor: QueryExecutor, moduleIds: readonly string[]) {
  if (moduleIds.length === 0) return new Set<string>()
  const rows = await executor
    .select({ moduleId: deploymentModules.moduleId })
    .from(deploymentModules)
    .where(and(inArray(deploymentModules.moduleId, moduleIds), eq(deploymentModules.enabled, true)))
  return new Set(rows.map(({ moduleId }) => moduleId))
}
