import { createAllianceClient } from '@evespace/esi-client/domains/alliance'
import { createCorporationClient } from '@evespace/esi-client/domains/corporation'
import type { DeploymentOrganizationType } from './db/schema.js'
import { esiFetch } from './esi-fetch.js'

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
    const alliance = await createAllianceClient({ fetch: esiFetch }).getPublicInfo(id)
    return { type, id, name: alliance.name, ticker: alliance.ticker }
  }

  const corporation = await createCorporationClient({ fetch: esiFetch }).getPublicInfo(id)
  return { type, id, name: corporation.name, ticker: corporation.ticker }
}
