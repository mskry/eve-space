import { getAlliancePublicResult } from '../alliances/public-data.js'
import {
  OrganizationAuthorityError,
  type CharacterAffiliation,
  type OrganizationIdentity,
} from './authority-policy.js'

export async function resolveOrganizationAuthorityCorporation(
  organization: OrganizationIdentity,
  affiliation: CharacterAffiliation,
) {
  return (await resolveOrganizationAuthorityCorporationEvidence(organization, affiliation))
    .corporationId
}

export async function resolveOrganizationAuthorityCorporationEvidence(
  organization: OrganizationIdentity,
  affiliation: CharacterAffiliation,
) {
  if (organization.organizationType === 'corporation') {
    if (affiliation.corporationId !== organization.organizationId)
      throw new OrganizationAuthorityError('wrong-corporation')
    return { corporationId: organization.organizationId, freshUntil: null }
  }

  if (affiliation.allianceId !== organization.organizationId)
    throw new OrganizationAuthorityError('wrong-alliance')
  const executor = await getAllianceExecutorCorporation(organization.organizationId)
  if (affiliation.corporationId !== executor.corporationId)
    throw new OrganizationAuthorityError('wrong-corporation')
  return executor
}

async function getAllianceExecutorCorporation(allianceId: number) {
  const result = await getAlliancePublicResult(allianceId)
  if (result.stale) throw new OrganizationAuthorityError('stale-affiliation')
  const executorCorporationId = result.data.executorCorporationId
  if (!executorCorporationId) throw new OrganizationAuthorityError('executor-unavailable')
  return { corporationId: executorCorporationId, freshUntil: new Date(result.cachedUntil) }
}
