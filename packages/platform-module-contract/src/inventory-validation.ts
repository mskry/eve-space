import {
  isPlatformContributionId,
  isPlatformExportName,
  isPlatformModuleId,
  semanticVersionSatisfies,
  semanticVersionRangeRequires,
} from './identifiers.js'
import {
  platformInventoryBounds,
  platformInventoryContractVersion,
  type PlatformInventoryConsumerDeclaration,
  type PlatformInventoryProviderDeclaration,
} from './inventory.js'
import { platformModuleHostContractVersion, type PlatformModuleManifest } from './manifest.js'

type InventoryDeclaration =
  | PlatformInventoryConsumerDeclaration
  | PlatformInventoryProviderDeclaration

const bounded = (value: number, maximum: number) =>
  Number.isSafeInteger(value) && value > 0 && value <= maximum

const declarationIssues = (declaration: InventoryDeclaration) => {
  const issues: string[] = []
  if (!isPlatformContributionId(declaration.id)) issues.push('invalid inventory identity')
  if (declaration.contractVersion !== platformInventoryContractVersion)
    issues.push('incompatible inventory contract version')
  const maximum =
    declaration.scope === 'personal'
      ? platformInventoryBounds.personalSubjects
      : platformInventoryBounds.corporationSubjects
  if (
    !bounded(declaration.maximumSubjects, maximum) ||
    !bounded(declaration.maximumPageSize, platformInventoryBounds.pageSize)
  )
    issues.push('invalid inventory bounds')
  return issues
}

const reviewerPermission = (manifest: PlatformModuleManifest, key: string) =>
  manifest.permissions?.some(
    (permission) =>
      permission.key === key &&
      permission.audiences.includes('hr') &&
      permission.audiences.includes('director'),
  )

const providerIssues = (
  manifest: PlatformModuleManifest,
  provider: PlatformInventoryProviderDeclaration,
) => {
  const issues = declarationIssues(provider)
  if (!isPlatformExportName(provider.exportName)) issues.push('invalid inventory executable export')
  if (
    !manifest.sections?.some(
      ({ id, kind }) => id === provider.sectionId && kind === 'sensitive-evidence',
    )
  )
    issues.push('inventory provider requires an owned sensitive-evidence section')
  if (!reviewerPermission(manifest, provider.requiredPermission))
    issues.push('inventory provider requires an owned HR/director review permission')
  const operations = provider.persistenceOperations.map(({ operationId }) => operationId)
  if (new Set(operations).size !== operations.length)
    issues.push('duplicate inventory persistence grants')
  if (
    operations.some(
      (id) =>
        manifest.server.persistenceOperations.find((operation) => operation.id === id)?.mode !==
        'read',
    )
  )
    issues.push('unknown, cross-schema or non-read inventory persistence grant')
  return issues
}

const corporationConsumerIssues = (
  manifest: PlatformModuleManifest,
  consumer: Extract<PlatformInventoryConsumerDeclaration, { scope: 'corporation' }>,
  manifests: readonly PlatformModuleManifest[],
) => {
  const issues: string[] = []
  if (!consumer.sourcePermission.startsWith(`${consumer.provider.moduleId}.`))
    issues.push('inventory source permission must belong to its provider')
  if (!reviewerPermission(manifest, consumer.requiredPermission))
    issues.push('inventory consumer requires an owned HR/director review permission')
  if (
    !isPlatformModuleId(consumer.provider.moduleId) ||
    !isPlatformContributionId(consumer.provider.providerId) ||
    consumer.provider.moduleId === manifest.id
  )
    issues.push('invalid inventory provider binding')
  const source = manifests.find(({ id }) => id === consumer.provider.moduleId)
  const provider = source?.server.inventoryProviders?.find(
    ({ id }) => id === consumer.provider.providerId,
  )
  if (!provider) {
    if (source || !consumer.provider.optional) issues.push('missing declared inventory provider')
    return issues
  }
  if (
    provider.contractVersion !== consumer.contractVersion ||
    provider.requiredPermission !== consumer.sourcePermission ||
    consumer.maximumSubjects > provider.maximumSubjects ||
    consumer.maximumPageSize > provider.maximumPageSize
  )
    issues.push('incompatible inventory provider binding or source permission')
  return issues
}

const consumerIssues = (
  manifest: PlatformModuleManifest,
  consumer: PlatformInventoryConsumerDeclaration,
  manifests: readonly PlatformModuleManifest[],
) => {
  const issues = declarationIssues(consumer)
  if (consumer.scope === 'corporation')
    return [...issues, ...corporationConsumerIssues(manifest, consumer, manifests)]
  if (consumer.provider !== 'core.character-assets')
    issues.push('personal inventory requires the core character-assets provider')
  return issues
}

const manifestIssues = (
  manifest: PlatformModuleManifest,
  manifests: readonly PlatformModuleManifest[],
) => {
  const providers = manifest.server.inventoryProviders ?? []
  const consumers = manifest.server.inventoryConsumers ?? []
  if (providers.length + consumers.length === 0) return []
  const issues: string[] = []
  if (
    !semanticVersionSatisfies(
      platformModuleHostContractVersion,
      manifest.release.hostContractRange,
    ) ||
    !semanticVersionRangeRequires('1.2.0', manifest.release.hostContractRange)
  )
    issues.push('inventory declarations require host contract 1.2.0 or newer')
  if (
    new Set([...providers, ...consumers].map(({ id }) => id)).size !==
    providers.length + consumers.length
  )
    issues.push('duplicate inventory declaration')
  const exports = [
    ...providers,
    ...manifest.server.routes,
    ...manifest.server.resources,
    ...manifest.server.esiOperations,
    ...manifest.server.persistenceOperations,
    ...manifest.server.activityProviders,
    ...(manifest.server.graphql ?? []),
  ].map(({ exportName }) => exportName)
  if (new Set(exports).size !== exports.length) issues.push('duplicate inventory executable export')
  return [
    ...issues,
    ...providers.flatMap((provider) => providerIssues(manifest, provider)),
    ...consumers.flatMap((consumer) => consumerIssues(manifest, consumer, manifests)),
  ].map((issue) => `${manifest.id}: ${issue}`)
}

export const validateInventoryDeclarations = (manifests: readonly PlatformModuleManifest[]) =>
  manifests.flatMap((manifest) => manifestIssues(manifest, manifests))
