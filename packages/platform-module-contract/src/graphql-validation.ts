import {
  platformGraphQLStrategies,
  type PlatformGraphQLContribution,
  type PlatformGraphQLReadDeclaration,
} from './graphql.js'
import type { PlatformModuleManifest } from './manifest.js'
import { inventoryGraphQLIssues } from './inventory-graphql-validation.js'
import { isPlatformContributionId } from './identifiers.js'
import { platformOrganizationAudiences } from './server.js'
import { validateCoreDataProducts, type PlatformModuleValidationAuthorities } from './validation.js'

const namePattern = /^[A-Za-z]\w*$/
const reservedTypes = new Set([
  'Query',
  'Mutation',
  'Subscription',
  'String',
  'Int',
  'Float',
  'Boolean',
  'ID',
  'EveId',
  'Decimal',
  'BigInteger',
  'UUID',
  'UTCTime',
  'UTCDate',
  'OwnedCharacter',
  'OwnedCharacterIdentity',
  'OwnedCharacterConnection',
  'AssetConnection',
  'Asset',
  'PageInfo',
  'AssetEnrichment',
  'AssetSource',
])
const reservedRoots = new Set(['ownedCharacters', 'ownedCharacter'])

type ProductContracts = PlatformModuleValidationAuthorities['coreDataProductContracts']

const boundedInteger = (value: number, maximum: number) =>
  Number.isSafeInteger(value) && value > 0 && value <= maximum
const moduleTypePrefix = (moduleId: string) =>
  moduleId
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')

const subjectIssues = (read: PlatformGraphQLReadDeclaration) => {
  const issues: string[] = []
  if (read.strategy === 'owned-character' && !read.subjectArgument)
    issues.push('owned-character requires an exact subject argument')
  if (
    read.subjectArgument &&
    (!['owned-character', 'personal-inventory', 'reviewer-corporation-inventory'].includes(
      read.strategy,
    ) ||
      !namePattern.test(read.subjectArgument))
  )
    issues.push('invalid subject argument')
  if (
    read.requiredScope &&
    (!['owned-character', 'personal-inventory'].includes(read.strategy) ||
      !read.requiredScope.startsWith('esi-'))
  )
    issues.push('invalid owned-character scope')
  return issues
}

const organizationIssues = (
  manifest: PlatformModuleManifest,
  read: PlatformGraphQLReadDeclaration,
) => {
  const issues: string[] = []
  if (read.strategy === 'organization-member' && !read.organization)
    issues.push('organization-member requires organization policy')
  if (read.strategy === 'public' && read.organization)
    issues.push('public cannot declare organization policy')
  if (!read.organization) return issues
  if (!platformOrganizationAudiences.includes(read.organization.audience))
    issues.push('unsupported organization audience')
  for (const permission of [
    read.organization.requiredPermission,
    ...(read.organization.additionalRequiredPermissions ?? []),
  ]) {
    const consumer = manifest.server.inventoryConsumers?.find(
      ({ id }) => id === read.inventoryConsumerId,
    )
    if (
      read.strategy === 'reviewer-corporation-inventory' &&
      consumer?.scope === 'corporation' &&
      permission === consumer.sourcePermission
    )
      continue
    if (
      !manifest.permissions?.some(
        ({ key, audiences }) =>
          key === permission && audiences.includes(read.organization!.audience),
      )
    )
      issues.push(`unknown or incompatible organization permission ${permission}`)
  }
  return issues
}

const securityIssues = (manifest: PlatformModuleManifest, read: PlatformGraphQLReadDeclaration) => {
  const issues = [...subjectIssues(read), ...organizationIssues(manifest, read)]
  if (!platformGraphQLStrategies.includes(read.strategy))
    issues.push('unsupported GraphQL strategy')
  issues.push(...inventoryGraphQLIssues(manifest, read))
  if (read.sectionId && !manifest.sections?.some(({ id }) => id === read.sectionId))
    issues.push('unknown section')
  return issues
}

const bindingIssues = (
  contribution: PlatformGraphQLContribution,
  read: PlatformGraphQLReadDeclaration,
) => {
  const issues: string[] = []
  if (!isPlatformContributionId(read.id)) issues.push('invalid read identity')
  const [type, field, extra] = read.field.split('.')
  const root = type === 'Query' && field === contribution.rootField
  if (!field || extra || !namePattern.test(field) || (!root && !contribution.types.includes(type!)))
    issues.push('invalid or cross-owner read field')
  if (
    !boundedInteger(read.cost, 5_000) ||
    !Number.isSafeInteger(read.sourceCost) ||
    read.sourceCost < 0 ||
    read.sourceCost > 5_000
  )
    issues.push('invalid cost bounds')
  if (
    read.list &&
    ((read.list.argument !== undefined && !namePattern.test(read.list.argument)) ||
      !boundedInteger(read.list.maximum, 1_000) ||
      !boundedInteger(read.list.defaultSize, read.list.maximum))
  )
    issues.push('invalid list bounds')
  return issues
}

const grantIssues = (
  manifest: PlatformModuleManifest,
  read: PlatformGraphQLReadDeclaration,
  products: ProductContracts,
) => {
  const issues: string[] = []
  for (const { operationId } of read.persistenceOperations) {
    const operation = manifest.server.persistenceOperations.find(({ id }) => id === operationId)
    if (operation?.mode !== 'read')
      issues.push(`unknown or non-read persistence grant ${operationId}`)
  }
  if (
    new Set(read.persistenceOperations.map(({ operationId }) => operationId)).size !==
    read.persistenceOperations.length
  )
    issues.push('duplicate persistence grants')
  validateCoreDataProducts(read, 'GraphQL read', 'graphql-read', products, issues)
  return issues
}

const typeIssues = (manifest: PlatformModuleManifest, contribution: PlatformGraphQLContribution) =>
  contribution.types.flatMap((type) => {
    if (
      !namePattern.test(type) ||
      reservedTypes.has(type) ||
      !type.startsWith(moduleTypePrefix(manifest.id))
    )
      return [`${manifest.id}/${contribution.id}: invalid, reserved or unnamespaced type ${type}`]
    return []
  })

const contributionIssues = (
  manifest: PlatformModuleManifest,
  contribution: PlatformGraphQLContribution,
  products: ProductContracts,
) => {
  const identity = `${manifest.id}/${contribution.id}`
  const issues = typeIssues(manifest, contribution)
  if (!isPlatformContributionId(contribution.id))
    issues.push(`${identity}: invalid contribution identity`)
  const rootNamespace = manifest.id.replaceAll('-', '')
  if (!contribution.rootField.startsWith(rootNamespace))
    issues.push(`${identity}: root field must use module namespace ${rootNamespace}`)
  if (!namePattern.test(contribution.rootField) || reservedRoots.has(contribution.rootField))
    issues.push(`${identity}: invalid or reserved root field`)
  if (!namePattern.test(contribution.exportName) || contribution.exportName === 'default')
    issues.push(`${identity}: invalid executable export`)
  if (!contribution.reads.some(({ field }) => field === `Query.${contribution.rootField}`))
    issues.push(`${identity}: root binding is missing`)
  const readIds = contribution.reads.map(({ id }) => id)
  const fields = contribution.reads.map(({ field }) => field)
  if (new Set(readIds).size !== readIds.length || new Set(fields).size !== fields.length)
    issues.push(`${identity}: duplicate read binding`)
  return [
    ...issues,
    ...contribution.reads.flatMap((read) =>
      [
        ...bindingIssues(contribution, read),
        ...securityIssues(manifest, read),
        ...grantIssues(manifest, read, products),
      ].map((issue) => `${identity}/${read.id}: ${issue}`),
    ),
  ]
}

export const validateGraphQLContributions = (
  manifests: readonly PlatformModuleManifest[],
  products: ProductContracts,
) => {
  const names = new Map<string, string>()
  const issues: string[] = []
  for (const manifest of manifests) {
    for (const executable of [
      ...manifest.server.routes,
      ...manifest.server.resources,
      ...manifest.server.persistenceOperations,
      ...manifest.server.esiOperations,
      ...manifest.server.activityProviders,
    ]) {
      names.set(
        `${manifest.server.package}:${executable.exportName}`,
        `${manifest.id}/${executable.id}`,
      )
    }
    for (const contribution of manifest.server.graphql ?? []) {
      issues.push(...contributionIssues(manifest, contribution, products))
      const identity = `${manifest.id}/${contribution.id}`
      for (const name of [
        `Query.${contribution.rootField}`,
        ...contribution.types,
        `${manifest.server.package}:${contribution.exportName}`,
        identity,
      ]) {
        const owner = names.get(name)
        if (owner) issues.push(`GraphQL name ${name} collides between ${owner} and ${identity}`)
        names.set(name, identity)
      }
    }
  }
  return issues
}
