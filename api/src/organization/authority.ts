import { publicAllianceRepresentation } from '../characters/profile.js'
import { execute } from '../esi-resilience/execute.js'
import {
  OrganizationAuthorityError,
  type CharacterAffiliation,
  type OrganizationIdentity,
} from './authority-policy.js'

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

async function getAllianceExecutorCorporationId(allianceId: number) {
  const result = await execute(publicAllianceRepresentation, { allianceId })
  if (result.stale) throw new OrganizationAuthorityError('stale-affiliation')
  const executorCorporationId = result.data.executorCorporationId
  if (!executorCorporationId) throw new OrganizationAuthorityError('executor-unavailable')
  return executorCorporationId
}
