import { serverSourceBoundaryViolations } from './feature-boundaries.js'

export interface ModuleServerSource {
  readonly path: string
  readonly source: string
}

export function moduleServerImportViolations(sources: readonly ModuleServerSource[]) {
  return sources
    .flatMap(({ path, source }) =>
      serverSourceBoundaryViolations({ moduleId: moduleIdFromPath(path), path, source }),
    )
    .toSorted((left, right) => left.localeCompare(right))
}

function moduleIdFromPath(path: string) {
  return path.replaceAll('\\', '/').split('/')[1] ?? 'unknown'
}
