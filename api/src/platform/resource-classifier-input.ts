import type { PlatformInstalledResourceDeclaration } from '@eve-space/platform-module-contract/resources'
import {
  assertRegisteredEsiOperation,
  getOptionalCharacterEsiScope,
} from '../esi-gateway/catalog-interface.js'
import { installedResourceIdentityKey } from './resource-identity.js'

export function createPlatformResourceClassifierInput(
  resources: readonly PlatformInstalledResourceDeclaration[],
) {
  const seen = new Set<string>()
  return resources.map((resource) => {
    const identity = installedResourceIdentityKey(resource)
    if (seen.has(identity)) {
      throw new Error(
        `Duplicate installed resource planning identity: ${resource.moduleId}/${resource.resourceId}/${resource.subjectKind}`,
      )
    }
    seen.add(identity)
    assertRegisteredEsiOperation(resource.operationId)
    return {
      eligibility_kind: resource.eligibility.kind,
      module_id: resource.moduleId,
      operation_id: resource.operationId,
      required_scope: getOptionalCharacterEsiScope(resource.operationId),
      resource_id: resource.resourceId,
      section_id: resource.sectionId,
      subject_kind: resource.subjectKind,
    }
  })
}
