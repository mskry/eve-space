import { posix } from 'node:path'
import { typescriptModuleSpecifiers } from '../typescript-module-specifiers.js'

const modulesByTier = {
  support: [
    'internal/numeric',
    'internal/quota-error',
    'internal/response-error-metadata',
    'internal/revalidation',
    'internal/runtime-config',
    'internal/timing',
  ],
  representation: [
    'internal/types',
    'internal/keys',
    'internal/identity',
    'internal/identity-projectors',
    'internal/envelope',
    'internal/l1-cache',
    'internal/cache-redaction',
    'internal/result-metadata',
  ],
  contract: [
    'internal/operation-metadata',
    'internal/catalog-validation',
    'internal/contract-types',
    'internal/catalog',
    'internal/catalog-access',
    'internal/policy',
    'internal/representations',
    'internal/representation-registry',
    'internal/runtime-ports',
    'catalog-interface',
  ],
  infrastructure: [
    'internal/coordination',
    'internal/coordination-connection',
    'internal/transport',
  ],
  execution: [
    'internal/execution-runtime',
    'internal/request-lifecycle',
    'internal/production-runtime',
    'internal/runtime-state',
    'internal/resource-revision',
    'internal/cooldowns',
    'internal/permits',
    'internal/local-quota',
    'internal/failure-policy',
    'feature-execution',
    'platform-execution',
    'failures',
    'runtime-lifecycle',
  ],
  recorderObservability: ['internal/telemetry-counters', 'internal/rate-measurement'],
  aggregateObservability: ['internal/telemetry', 'status-interface'],
} as const

type EsiGatewayTier = keyof typeof modulesByTier

const tierByModule = new Map<string, EsiGatewayTier>(
  Object.entries(modulesByTier).flatMap(([tier, modules]) =>
    modules.map((module) => [module, tier as EsiGatewayTier]),
  ),
)

const allowedImportTiersBySourceTier: Record<EsiGatewayTier, readonly EsiGatewayTier[]> = {
  support: [],
  representation: ['support', 'representation', 'contract', 'recorderObservability'],
  contract: ['support', 'representation', 'contract', 'recorderObservability'],
  infrastructure: [
    'support',
    'representation',
    'contract',
    'infrastructure',
    'recorderObservability',
  ],
  execution: [
    'support',
    'representation',
    'contract',
    'infrastructure',
    'execution',
    'recorderObservability',
  ],
  recorderObservability: ['support', 'representation', 'contract', 'recorderObservability'],
  aggregateObservability: [
    'support',
    'representation',
    'contract',
    'infrastructure',
    'execution',
    'recorderObservability',
    'aggregateObservability',
  ],
}

const sharedExternalDependencies = new Set([
  'api/src/type-guards',
  '@eve-space/platform-module-contract',
  '@eve-space/platform-module-server',
  '@evespace/esi-client',
  '@evespace/esi-client/operations',
  'node:crypto',
  'zod',
])

const externalDependenciesByModule: Readonly<Record<string, readonly string[]>> = {
  'catalog-interface': ['api/src/generated/platform/installed-module-esi'],
  'internal/catalog': ['api/src/generated/platform/installed-module-esi'],
  'internal/catalog-access': ['api/src/generated/platform/installed-module-esi'],
  'internal/coordination': ['ioredis'],
  'internal/coordination-connection': ['api/src/coordination-redis'],
  'internal/cooldowns': ['ioredis'],
  'internal/failure-policy': ['api/src/auth/token-errors'],
  'internal/permits': ['ioredis'],
  'internal/production-runtime': ['api/src/auth/tokens', 'api/src/env', 'api/src/cache-redis'],
  'internal/request-lifecycle': ['effect'],
  'internal/rate-measurement': ['ioredis'],
  'internal/telemetry-counters': ['ioredis', 'api/src/cache-redis'],
  'internal/telemetry': ['ioredis', 'api/src/cache-redis', 'api/src/coordination-redis'],
  'status-interface': ['api/src/cache-redis'],
}

export interface EsiGatewaySource {
  readonly path: string
  readonly source: string
}

export function esiGatewayImportViolations(sources: readonly EsiGatewaySource[]) {
  const tiers = sources.flatMap(violationsForSource)
  const cycles = dependencyCycles(sources)
  return [...tiers, ...cycles].toSorted((left, right) => left.localeCompare(right))
}

export function esiGatewayConsumerImportViolations(
  sources: readonly EsiGatewaySource[],
  consumer: 'core' | 'installed-module',
) {
  return sources
    .flatMap(({ path, source }) =>
      typescriptModuleSpecifiers(path, source).flatMap((specifier) => {
        if (specifier.includes('/esi-gateway/internal/'))
          return [`${path}: ${consumer} code cannot import ESI gateway internal modules`]
        if (
          consumer === 'core' &&
          !path.startsWith('api/src/platform/') &&
          specifier.endsWith('/esi-gateway/platform-execution.js')
        )
          return [`${path}: core code cannot import ESI gateway platform execution`]
        if (
          consumer === 'installed-module' &&
          (specifier.endsWith('/esi-gateway/feature-execution.js') ||
            specifier === '@evespace/esi-client' ||
            specifier.startsWith('@evespace/esi-client/'))
        )
          return [`${path}: installed module cannot import core ESI execution or SDK runtime code`]
        return []
      }),
    )
    .toSorted((left, right) => left.localeCompare(right))
}

/** Gateway-owned tests may exercise internal adapters; the Redis suite is the integration exception. */
export function esiGatewayExternalInternalViolations(sources: readonly EsiGatewaySource[]) {
  return sources.flatMap(({ path, source }) => {
    if (
      path === 'scripts/esi-gateway/boundaries.ts' ||
      path === 'scripts/module-registry/authorities.ts' ||
      path.startsWith('api/tests/esi-gateway/') ||
      path === 'api/tests/integration/redis/esi-gateway.test.ts'
    )
      return []
    return /['"][^'"]*esi-gateway\/internal\//.test(source)
      ? [`${path}: external code cannot import or mock ESI gateway internal modules`]
      : []
  })
}

function violationsForSource(source: EsiGatewaySource) {
  const module = gatewayModuleName(source.path)
  const sourceTier = tierByModule.get(module)
  if (!sourceTier) return [`${source.path}: ESI gateway module ${module} has no declared tier`]

  return typescriptModuleSpecifiers(source.path, source.source).flatMap((specifier) => {
    const importedModule = localGatewayModuleName(module, specifier)
    if (!importedModule) return externalDependencyViolations(source.path, module, specifier)
    const importedTier = tierByModule.get(importedModule)
    const allowedImportTiers = allowedImportTiersBySourceTier[sourceTier]
    if (!importedTier || allowedImportTiers.includes(importedTier)) return []
    return [
      `${source.path}: ${sourceTier} module ${module} cannot import ${importedTier} module ${importedModule}`,
    ]
  })
}

function externalDependencyViolations(path: string, module: string, specifier: string) {
  const dependency = specifier.startsWith('.')
    ? posix.normalize(posix.join(posix.dirname(path), specifier)).replace(/\.(?:[cm]?js|ts)$/, '')
    : specifier
  if (dependency === 'api/src/env' && module !== 'internal/production-runtime')
    return [`${path}: only the production runtime may import application configuration`]
  if (
    sharedExternalDependencies.has(dependency) ||
    externalDependenciesByModule[module]?.includes(dependency)
  )
    return []
  return [`${path}: module ${module} cannot import external dependency ${dependency}`]
}

function dependencyCycles(sources: readonly EsiGatewaySource[]) {
  const modules = new Map(sources.map((source) => [gatewayModuleName(source.path), source]))
  const visited = new Set<string>()
  const active: string[] = []
  const cycles = new Set<string>()

  for (const module of modules.keys()) visitModule(module, modules, visited, active, cycles)
  return [...cycles].map((cycle) => `ESI gateway dependency cycle: ${cycle}`)
}

function visitModule(
  module: string,
  modules: ReadonlyMap<string, EsiGatewaySource>,
  visited: Set<string>,
  active: string[],
  cycles: Set<string>,
): void {
  if (visited.has(module)) return
  const activeIndex = active.indexOf(module)
  if (activeIndex !== -1) {
    cycles.add([...active.slice(activeIndex), module].join(' -> '))
    return
  }
  const source = modules.get(module)
  if (!source) return
  active.push(module)
  for (const specifier of typescriptModuleSpecifiers(source.path, source.source)) {
    const importedModule = localGatewayModuleName(module, specifier)
    if (importedModule && modules.has(importedModule))
      visitModule(importedModule, modules, visited, active, cycles)
  }
  active.pop()
  visited.add(module)
}

function gatewayModuleName(path: string) {
  return path
    .replaceAll('\\', '/')
    .replace(/^api\/src\/esi-gateway\//, '')
    .replace(/\.ts$/, '')
}

function localGatewayModuleName(sourceModule: string, specifier: string) {
  if (!specifier.startsWith('.')) return undefined
  const resolved = posix.normalize(posix.join(posix.dirname(sourceModule), specifier))
  if (resolved === '..' || resolved.startsWith('../')) return undefined
  return resolved.replace(/\.(?:[cm]?js|ts)$/, '')
}
