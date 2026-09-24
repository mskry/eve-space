import { getAlliancePublicResult } from '../alliances/public-data.js'
import { getCorporationPublic } from '../corporations/public-data.js'
import type { DeploymentOrganizationType } from '../db/schema.js'

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
    const alliance = (await getAlliancePublicResult(id)).data
    return { id, name: alliance.name, ticker: alliance.ticker, type }
  }

  const corporation = await getCorporationPublic(id)
  return { id, name: corporation.name, ticker: corporation.ticker, type }
}
