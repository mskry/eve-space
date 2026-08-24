import { createAllianceClient } from '@evespace/esi-client/domains/alliance'
import { createCorporationClient } from '@evespace/esi-client/domains/corporation'
import type { DeploymentOrganizationType } from './db/schema.js'
import { getEsiResilienceLayer } from './esi-resilience/resilience.js'
import { createEsiTransport } from './esi-resilience/transport.js'

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
      await getEsiResilienceLayer().get({
        operation: 'public-alliance',
        resource: `alliance-${id}`,
        load: (revalidation) =>
          createAllianceClient({ fetch: createEsiTransport('public-alliance') })
            .withMetadata()
            .getPublicInfo(id, revalidation),
      })
    ).data
    return { type, id, name: alliance.name, ticker: alliance.ticker }
  }

  const corporation = (
    await getEsiResilienceLayer().get({
      operation: 'public-corporation',
      resource: `corporation-${id}`,
      load: (revalidation) =>
        createCorporationClient({ fetch: createEsiTransport('public-corporation') })
          .withMetadata()
          .getPublicInfo(id, revalidation),
    })
  ).data
  return { type, id, name: corporation.name, ticker: corporation.ticker }
}
