import { EsiQuotaError } from '../esi-resilience/cooldowns.js'
import { acquireEsiRequestPermit } from '../esi-resilience/permits.js'
import { getCoordinationConnection } from '../esi-resilience/coordination-connection.js'
import { env } from '../env.js'

export async function affiliationCooldownActive() {
  try {
    const permit = await acquireEsiRequestPermit({
      connection: getCoordinationConnection(),
      operation: 'bulk-affiliation',
      concurrency: env.ESI_OPERATION_CONCURRENCY,
    })
    await permit.release()
    return false
  } catch (error) {
    if (error instanceof EsiQuotaError) return true
    throw error
  }
}
