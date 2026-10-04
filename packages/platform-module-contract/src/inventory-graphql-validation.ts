import type { PlatformGraphQLReadDeclaration } from './graphql.js'
import type { PlatformModuleManifest } from './manifest.js'
import type { PlatformInventoryConsumerDeclaration } from './inventory.js'

const assetsScope = 'esi-assets.read_assets.v1'

const corporationIssues = (
  consumer: Extract<PlatformInventoryConsumerDeclaration, { scope: 'corporation' }>,
  read: PlatformGraphQLReadDeclaration,
) => {
  const issues: string[] = []
  if (!read.subjectArgument || read.requiredScope)
    issues.push('corporation inventory requires an exact corporation selector')
  const organization = read.organization
  if (
    !organization ||
    !['hr', 'director'].includes(organization.audience) ||
    organization.requiredPermission !== consumer.requiredPermission ||
    organization.additionalRequiredPermissions?.length !== 1 ||
    organization.additionalRequiredPermissions[0] !== consumer.sourcePermission
  )
    issues.push('corporation inventory requires exact aggregate and source review permissions')
  return issues
}

const inventoryReadBoundsIssues = (
  consumer: PlatformInventoryConsumerDeclaration,
  read: PlatformGraphQLReadDeclaration,
) => {
  const issues: string[] = []
  if (read.persistenceOperations.length || read.coreDataProducts.length || read.sectionId)
    issues.push('aggregate reads cannot receive excess source grants')
  if (
    read.sourceCost < consumer.maximumSubjects ||
    (read.list && read.list.maximum > consumer.maximumPageSize)
  )
    issues.push('aggregate source cost or output bounds understate inventory work')
  return issues
}

export const inventoryGraphQLIssues = (
  manifest: PlatformModuleManifest,
  read: PlatformGraphQLReadDeclaration,
) => {
  const aggregate =
    read.strategy === 'personal-inventory' || read.strategy === 'reviewer-corporation-inventory'
  if (!aggregate)
    return read.inventoryConsumerId ? ['inventory capability requires its aggregate strategy'] : []
  const consumer = manifest.server.inventoryConsumers?.find(
    ({ id }) => id === read.inventoryConsumerId,
  )
  if (!consumer) return ['aggregate strategy requires an exact inventory consumer']
  const issues = inventoryReadBoundsIssues(consumer, read)
  const personal = read.strategy === 'personal-inventory'
  if ((consumer.scope === 'personal') !== personal)
    issues.push('inventory strategy and consumer scope differ')
  if (personal) {
    if (read.organization || read.requiredScope !== assetsScope)
      issues.push('personal inventory requires only owned assets authority')
    return issues
  }
  if (consumer.scope !== 'corporation') return issues
  return [...issues, ...corporationIssues(consumer, read)]
}
