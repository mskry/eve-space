import { isEsiOperationQuotaLimited } from '../esi-gateway/failures.js'

export async function affiliationCooldownActive() {
  return isEsiOperationQuotaLimited('bulk-affiliation')
}
