export interface OrganizationIdentity {
  organizationType: 'corporation' | 'alliance'
  organizationId: number
}

export interface CharacterAffiliation {
  corporationId: number
  allianceId: number | null
}

export interface OrganizationDirectorRoles {
  readonly roles: readonly string[]
}

export class OrganizationAuthorityError extends Error {
  constructor(
    readonly code:
      | 'missing-scope'
      | 'wrong-corporation'
      | 'wrong-alliance'
      | 'stale-affiliation'
      | 'executor-unavailable'
      | 'not-director',
  ) {
    super(code)
  }
}

export function assertOrganizationOwnerAuthorization(
  requiredScope: string,
  scopes: readonly string[],
  roles: OrganizationDirectorRoles,
) {
  assertOrganizationOwnerScope(requiredScope, scopes)
  assertOrganizationOwnerDirectorRole(roles)
}

export function assertOrganizationOwnerScope(requiredScope: string, scopes: readonly string[]) {
  if (!scopes.includes(requiredScope)) throw new OrganizationAuthorityError('missing-scope')
}

export function assertOrganizationOwnerDirectorRole(roles: OrganizationDirectorRoles) {
  if (!roles.roles.includes('Director')) throw new OrganizationAuthorityError('not-director')
}
