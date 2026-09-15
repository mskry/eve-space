import { posix } from 'node:path'
import { findDependencyCycles } from '../dependency-cycles.js'
import { typescriptModuleSpecifiers } from '../typescript-module-specifiers.js'

const allowedDependenciesByModule = {
  'entry-state': ['envelope'],
  envelope: ['shape'],
  notifications: ['envelope', 'shape'],
  'private-lifecycle': ['envelope', 'notifications', 'shape', 'storage'],
  runtime: ['entry-state', 'envelope', 'notifications', 'private-lifecycle', 'state', 'storage'],
  shape: [],
  state: ['entry-state', 'envelope', 'shape'],
  storage: ['envelope', 'shape'],
} as const

const allowedExternalDependenciesByModule: Partial<
  Record<QueryPersistenceModule, ReadonlySet<string>>
> = {
  'entry-state': new Set([
    '@eve-space/platform-module-nuxt/runtime',
    'app/utils/esi-freshness',
    'app/utils/query-error',
  ]),
  'private-lifecycle': new Set(['app/queries/auth']),
}

type QueryPersistenceModule = keyof typeof allowedDependenciesByModule

export interface QueryPersistenceSource {
  readonly path: string
  readonly source: string
}

export function queryPersistenceImportViolations(sources: readonly QueryPersistenceSource[]) {
  const sourcesByModule = groupBy(sources, ({ path }) => moduleName(path))
  const violations = declarationViolations(sourcesByModule)

  for (const source of sources) {
    const module = moduleName(source.path)
    if (!isDeclaredModule(module) || sourcesByModule.get(module)?.length !== 1) continue
    for (const specifier of typescriptModuleSpecifiers(source.path, source.source)) {
      const dependency = dependencyIdentity(source.path, specifier)
      const dependencyModule = queryPersistenceModuleName(dependency)
      if (
        dependencyModule &&
        !allowedDependenciesByModule[module].includes(dependencyModule as never)
      ) {
        violations.push(
          `${source.path}: query persistence module ${module} cannot import module ${dependencyModule}`,
        )
        continue
      }
      const allowedExternalDependencies = allowedExternalDependenciesByModule[module]
      if (!dependencyModule && allowedExternalDependencies?.has(dependency) === false) {
        violations.push(
          `${source.path}: query persistence module ${module} cannot import external dependency ${specifier}`,
        )
      }
    }
  }

  violations.push(
    ...findDependencyCycles(
      sources.filter(({ path }) => isDeclaredModule(moduleName(path))),
      ({ path }) => moduleName(path),
      ({ path, source }) =>
        typescriptModuleSpecifiers(path, source).map((specifier) =>
          queryPersistenceModuleName(dependencyIdentity(path, specifier)),
        ),
    ).map((cycle) => `Query persistence dependency cycle: ${cycle}`),
  )

  return violations.toSorted((left, right) => left.localeCompare(right))
}

export function queryPersistenceConsumerImportViolations(
  sources: readonly QueryPersistenceSource[],
) {
  return sources
    .flatMap((source) =>
      typescriptModuleSpecifiers(source.path, source.source).flatMap((specifier) => {
        const dependency = dependencyIdentity(source.path, specifier)
        const module = queryPersistenceModuleName(dependency)
        return module && module !== 'runtime'
          ? [`${source.path}: application caller cannot import query persistence module ${module}`]
          : []
      }),
    )
    .toSorted((left, right) => left.localeCompare(right))
}

function declarationViolations(
  sourcesByModule: ReadonlyMap<string, readonly QueryPersistenceSource[]>,
) {
  const violations: string[] = []
  for (const module of Object.keys(allowedDependenciesByModule)) {
    const sources = sourcesByModule.get(module)
    if (!sources) violations.push(`Declared query persistence module ${module} has no source file`)
    else if (sources.length > 1)
      violations.push(
        `Query persistence module ${module} has duplicate source ownership: ${sources.map(({ path }) => path).join(', ')}`,
      )
  }
  for (const [module, sources] of sourcesByModule) {
    if (!isDeclaredModule(module))
      violations.push(`${sources[0]!.path}: Query persistence module ${module} is not declared`)
  }
  return violations
}

function moduleName(path: string) {
  const relativePath = queryPersistenceRelativePath(path)
  const extension = posix.extname(relativePath)
  return relativePath.slice(0, extension ? -extension.length : undefined)
}

function queryPersistenceModuleName(path: string) {
  const marker = 'app/query-persistence/'
  return path.startsWith(marker) ? moduleName(path) : undefined
}

function queryPersistenceRelativePath(path: string) {
  const normalized = path.replaceAll('\\', '/')
  const marker = 'app/query-persistence/'
  const markerIndex = normalized.lastIndexOf(marker)
  return markerIndex === -1 ? normalized : normalized.slice(markerIndex + marker.length)
}

function dependencyIdentity(sourcePath: string, specifier: string) {
  if (specifier.startsWith('~/') || specifier.startsWith('@/'))
    return posix.normalize(`app/${specifier.slice(2)}`)
  if (!specifier.startsWith('.')) return specifier
  return posix.normalize(posix.join(posix.dirname(sourcePath.replaceAll('\\', '/')), specifier))
}

function isDeclaredModule(module: string): module is QueryPersistenceModule {
  return Object.hasOwn(allowedDependenciesByModule, module)
}

function groupBy<Value>(values: readonly Value[], keyForValue: (value: Value) => string) {
  const grouped = new Map<string, Value[]>()
  for (const value of values) {
    const key = keyForValue(value)
    const group = grouped.get(key)
    if (group) group.push(value)
    else grouped.set(key, [value])
  }
  return grouped
}
