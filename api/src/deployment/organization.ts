import { publicAllianceRepresentation } from '../characters/profile.js'
import { getCorporationPublic } from '../corporations/public-data.js'
import type { DeploymentOrganizationType } from '../db/schema.js'
import { execute } from '../esi-resilience/execute.js'

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
    const alliance = (await execute(publicAllianceRepresentation, { allianceId: id })).data
    return { type, id, name: alliance.name, ticker: alliance.ticker }
  }

  const corporation = await getCorporationPublic(id)
  return { type, id, name: corporation.name, ticker: corporation.ticker }
}
