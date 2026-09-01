import { createAllianceClient } from '@evespace/esi-client/domains/alliance'
import type { CharacterCorporationRoles } from '../characters/corporation-roles.js'
import { getEsiResilienceLayer } from '../esi-resilience/resilience.js'
import { createEsiTransport } from '../esi-resilience/transport.js'

export interface OrganizationIdentity {
  organizationType: 'corporation' | 'alliance'
  organizationId: number
}

export interface CharacterAffiliation {
  corporationId: number
  allianceId: number | null
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

export async function resolveOrganizationAuthorityCorporation(
  organization: OrganizationIdentity,
  affiliation: CharacterAffiliation,
) {
  if (organization.organizationType === 'corporation') {
    if (affiliation.corporationId !== organization.organizationId)
      throw new OrganizationAuthorityError('wrong-corporation')
    return organization.organizationId
  }

  if (affiliation.allianceId !== organization.organizationId)
    throw new OrganizationAuthorityError('wrong-alliance')
  const executorCorporationId = await getAllianceExecutorCorporationId(organization.organizationId)
  if (affiliation.corporationId !== executorCorporationId)
    throw new OrganizationAuthorityError('wrong-corporation')
  return executorCorporationId
}

export function assertOrganizationOwnerAuthorization(
  requiredScope: string,
  scopes: readonly string[],
  roles: CharacterCorporationRoles,
) {
  assertOrganizationOwnerScope(requiredScope, scopes)
  assertOrganizationOwnerDirectorRole(roles)
}

export function assertOrganizationOwnerScope(requiredScope: string, scopes: readonly string[]) {
  if (!scopes.includes(requiredScope)) throw new OrganizationAuthorityError('missing-scope')
}

export function assertOrganizationOwnerDirectorRole(roles: CharacterCorporationRoles) {
  if (!roles.roles.includes('Director')) throw new OrganizationAuthorityError('not-director')
}

async function getAllianceExecutorCorporationId(allianceId: number) {
  const result = await getEsiResilienceLayer().getPublic({
    operation: 'public-alliance',
    inputs: { allianceId },
    load: (revalidation) =>
      createAllianceClient({ fetch: createEsiTransport('public-alliance') })
        .withMetadata()
        .getPublicInfo(allianceId, revalidation),
  })
  if (result.stale) throw new OrganizationAuthorityError('stale-affiliation')
  const executorCorporationId = result.data.executor_corporation_id
  if (!executorCorporationId) throw new OrganizationAuthorityError('executor-unavailable')
  return executorCorporationId
}
