export interface CatalogPermission {
  readonly publisherPackage: string
  readonly moduleId: string
  readonly key: string
  readonly label: string
  readonly purpose: string
  readonly audiences: readonly ('member' | 'hr' | 'director')[]
  readonly sensitivity: 'standard' | 'sensitive'
  readonly reviewAllowed: boolean
}

export interface CatalogProfile {
  readonly publisherPackage: string
  readonly moduleId: string
  readonly id: string
  readonly label: string
  readonly description: string
  readonly audiences: readonly ('member' | 'hr' | 'director')[]
  readonly permissions: readonly string[]
}

export interface ModulePermissionSelection {
  readonly type: 'module'
  readonly publisherPackage: string
  readonly moduleId: string
  readonly key: string
}

interface ServicePermissionSelection {
  readonly type: 'service'
  readonly key: string
  readonly reviewAllowed?: boolean
}

export type PermissionSelection = ModulePermissionSelection | ServicePermissionSelection

export interface EffectivePermissionIdentity {
  readonly type: 'service' | 'module'
  readonly key: string
  readonly publisherPackage: string | null
  readonly moduleId: string | null
}

export interface PermissionCatalogIndex {
  readonly permissions: readonly CatalogPermission[]
  readonly profiles: readonly CatalogProfile[]
  readonly permissionsByIdentity: ReadonlyMap<string, CatalogPermission>
  readonly profilesByIdentity: ReadonlyMap<string, CatalogProfile>
}

export function createPermissionCatalogIndex(
  permissions: readonly CatalogPermission[],
  profiles: readonly CatalogProfile[],
): PermissionCatalogIndex {
  return {
    permissions,
    permissionsByIdentity: new Map(
      permissions.map((permission) => [permissionIdentity(permission), permission]),
    ),
    profiles,
    profilesByIdentity: new Map(profiles.map((profile) => [profileIdentity(profile), profile])),
  }
}

export function findCatalogPermission(
  catalog: PermissionCatalogIndex,
  identity: Pick<ModulePermissionSelection, 'publisherPackage' | 'moduleId' | 'key'>,
) {
  return catalog.permissionsByIdentity.get(permissionIdentity(identity))
}

export function findCatalogProfile(
  catalog: PermissionCatalogIndex,
  identity: Pick<CatalogProfile, 'publisherPackage' | 'moduleId' | 'id'>,
) {
  return catalog.profilesByIdentity.get(profileIdentity(identity))
}

export function uniquePermissionSelections(selections: readonly PermissionSelection[]) {
  const unique = new Map<string, PermissionSelection>()
  for (const selection of selections) {
    const identity =
      selection.type === 'module'
        ? `module:${permissionIdentity(selection)}`
        : `service:${selection.key}`
    const existing = unique.get(identity)
    unique.set(
      identity,
      selection.type === 'service'
        ? {
            ...selection,
            reviewAllowed: Boolean(
              (existing?.type === 'service' && existing.reviewAllowed) || selection.reviewAllowed,
            ),
          }
        : selection,
    )
  }
  return [...unique.values()]
}

function permissionIdentity(
  permission: Pick<CatalogPermission, 'publisherPackage' | 'moduleId' | 'key'>,
) {
  return `${permission.publisherPackage}\u0000${permission.moduleId}\u0000${permission.key}`
}

function profileIdentity(profile: Pick<CatalogProfile, 'publisherPackage' | 'moduleId' | 'id'>) {
  return `${profile.publisherPackage}\u0000${profile.moduleId}\u0000${profile.id}`
}
