import type { PlatformModulePolicy } from '@eve-space/platform-module-contract/compiler'
import type { PlatformRouteContribution } from '@eve-space/platform-module-contract/manifest'
import type { PlatformResourceContribution } from '@eve-space/platform-module-contract/resources'
import type { PlatformModuleSectionContribution } from '@eve-space/platform-module-contract/server'

const EXPECTED_SECTIONS = new Map<string, PlatformModuleSectionContribution['kind']>([
  ['overview', 'workspace'],
  ['skills', 'sensitive-evidence'],
  ['assets', 'sensitive-evidence'],
  ['wallet', 'sensitive-evidence'],
  ['mail', 'sensitive-evidence'],
  ['access-management', 'access-management'],
])

const SECTION_OPERATIONS = new Map<string, ReadonlySet<string>>([
  ['skills', new Set(['skills', 'skill-queue'])],
  ['assets', new Set(['character-assets-page', 'character-asset-names', 'universe-resolve-names'])],
  ['wallet', new Set(['wallet-balance', 'wallet-journal', 'wallet-transactions'])],
  ['mail', new Set(['mail-headers', 'mail-message', 'mail-lists', 'universe-resolve-names'])],
])

export const memberAuditModulePolicy = {
  moduleId: 'member-audit',
  evaluate(manifest) {
    const issues: string[] = []
    const sections = new Map(
      (manifest.sections ?? []).map((section) => [section.id.toLowerCase(), section]),
    )

    if (manifest.defaultEnabled !== false) issues.push('module member-audit must default disabled')
    validateSections(sections, issues)
    validateRoutes(manifest.server.routes, issues)
    if (manifest.server.activityProviders.length > 0)
      issues.push('module member-audit cannot declare activity providers')
    if (manifest.server.esiOperations.length > 0)
      issues.push('module member-audit must reuse core ESI operation identities')
    if (manifest.nuxt.pages.length > 0 || manifest.nuxt.navigation.length > 0)
      issues.push(
        'module member-audit cannot register pages or navigation before a reviewer-aware Nuxt gate is available',
      )
    validateResources(manifest.server.resources, sections, issues)

    return issues
  },
} satisfies PlatformModulePolicy

function validateSections(
  sections: ReadonlyMap<string, PlatformModuleSectionContribution>,
  issues: string[],
) {
  for (const [sectionId, kind] of EXPECTED_SECTIONS) {
    const section = sections.get(sectionId)
    if (!section) issues.push(`module member-audit must declare section ${sectionId}`)
    else if (section.kind !== kind)
      issues.push(`section member-audit/${sectionId} must use kind ${kind}`)
  }
  for (const section of sections.values())
    if (!EXPECTED_SECTIONS.has(section.id))
      issues.push(`module member-audit cannot declare unsupported section ${section.id}`)
}

function validateRoutes(routes: readonly PlatformRouteContribution[], issues: string[]) {
  for (const route of routes) validateRoute(route, issues)
}

function validateRoute(route: PlatformRouteContribution, issues: string[]) {
  const identity = `member-audit/${route.id}`
  if (route.target === undefined || route.target === 'caller')
    issues.push(`Member Audit route ${identity} must declare a managed reviewer target`)
  if (route.audience !== 'hr' && route.audience !== 'director')
    issues.push(`Member Audit route ${identity} must require an HR or director audience`)
  if (route.sectionId !== 'overview') return
  if (
    route.target !== 'managed-organization-account-search' &&
    route.target !== 'managed-organization-account'
  )
    issues.push(`Member Audit overview route ${identity} must target search or one account`)
  if (
    route.target === 'managed-organization-account' &&
    route.requiredPermission !== 'member-audit.summary.read'
  )
    issues.push(
      `Member Audit account summary route ${identity} must require member-audit.summary.read`,
    )
}

function validateResources(
  resources: readonly PlatformResourceContribution[],
  sections: ReadonlyMap<string, PlatformModuleSectionContribution>,
  issues: string[],
) {
  for (const resource of resources) validateResource(resource, sections, issues)
}

function validateResource(
  resource: PlatformResourceContribution,
  sections: ReadonlyMap<string, PlatformModuleSectionContribution>,
  issues: string[],
) {
  const section = resource.sectionId ? sections.get(resource.sectionId.toLowerCase()) : undefined
  if (section?.kind === 'sensitive-evidence' && resource.subjectKind !== 'character')
    issues.push(
      `Member Audit sensitive resource member-audit/${resource.id} must use a character subject`,
    )
  const allowedOperations = resource.sectionId
    ? SECTION_OPERATIONS.get(resource.sectionId)
    : undefined
  for (const operationId of [
    resource.operationId,
    ...(resource.dependentOperationIds ?? []),
    ...(resource.batch ? [resource.batch.operationId] : []),
  ])
    if (!allowedOperations?.has(operationId))
      issues.push(
        `Member Audit resource member-audit/${resource.id} cannot use ESI operation ${operationId} in section ${String(resource.sectionId)}`,
      )
}
