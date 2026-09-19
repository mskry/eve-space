import { serverSourceBoundaryViolations, type FeatureBoundarySource } from './feature-boundaries.js'

export interface ModuleServerSource extends Partial<FeatureBoundarySource> {
  readonly moduleId?: string
  readonly path: string
  readonly source: string
}

export function moduleServerImportViolations(sources: readonly ModuleServerSource[]) {
  return sources
    .flatMap((source) =>
      serverSourceBoundaryViolations({
        ...source,
        moduleId: source.moduleId ?? moduleIdFromPath(source.path),
      }),
    )
    .toSorted((left, right) => left.localeCompare(right))
}

function moduleIdFromPath(path: string) {
  return path.replaceAll('\\', '/').split('/')[1] ?? 'unknown'
}
