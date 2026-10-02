import type { ReadAdmissionDenial } from '../auth/read-policy.js'
import { routeNotFoundBody } from '../http/contracts.js'
import { isInstalledModuleContributionEnabled } from './module-settings.js'

export const moduleReadEnablementDenial = async (
  moduleId: string,
  sectionId?: string,
): Promise<ReadAdmissionDenial | null> =>
  (await isInstalledModuleContributionEnabled(moduleId, sectionId))
    ? null
    : { admitted: false, status: 404, body: routeNotFoundBody }
