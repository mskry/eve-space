import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract'

interface InstalledResourceIdentity {
  readonly moduleId: string
  readonly resourceId: string
  readonly subjectKind: string
}

export function findInstalledResource(
  identity: InstalledResourceIdentity,
  resources: readonly PlatformInstalledResourceDescriptor[],
) {
  return resources.find(
    (resource) => installedResourceIdentityKey(resource) === installedResourceIdentityKey(identity),
  )
}

export function installedResourceIdentityKey(identity: InstalledResourceIdentity) {
  return `${identity.moduleId}\0${identity.resourceId}\0${identity.subjectKind}`
}
