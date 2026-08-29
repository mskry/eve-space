import { createAllianceClient } from '@evespace/esi-client/domains/alliance'
import { getCorporationPublic } from '../corporations/public-data.js'
import type { DeploymentOrganizationType } from '../db/schema.js'
import { getEsiResilienceLayer } from '../esi-resilience/resilience.js'
import { createEsiTransport } from '../esi-resilience/transport.js'

export interface DeploymentOrganization {
  type: DeploymentOrganizationType
  id: number
  name: string
  ticker: string
}

export async function resolveDeploymentOrganization(
  type: DeploymentOrganizationType,
  id: number,
): Promise<DeploymentOrganization> {
  if (type === 'alliance') {
    const alliance = (
      await getEsiResilienceLayer().getPublic({
        operation: 'public-alliance',
        inputs: { allianceId: id },
        load: (revalidation) =>
          createAllianceClient({ fetch: createEsiTransport('public-alliance') })
            .withMetadata()
            .getPublicInfo(id, revalidation),
      })
    ).data
    return { type, id, name: alliance.name, ticker: alliance.ticker }
  }

  const corporation = await getCorporationPublic(id)
  return { type, id, name: corporation.name, ticker: corporation.ticker }
}
