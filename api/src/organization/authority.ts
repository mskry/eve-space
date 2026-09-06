import { createAllianceClient } from '@evespace/esi-client/domains/alliance'
import { getEsiResilienceLayer } from '../esi-resilience/layer.js'
import { createEsiTransport } from '../esi-resilience/request-transport.js'
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
