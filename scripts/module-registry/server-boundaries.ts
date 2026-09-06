import { typescriptModuleSpecifiers } from '../typescript-module-specifiers.js'

export interface ModuleServerSource {
  readonly path: string
  readonly source: string
}

export function moduleServerImportViolations(sources: readonly ModuleServerSource[]) {
  const violations: string[] = []
  for (const { path, source } of sources) {
    for (const specifier of typescriptModuleSpecifiers(path, source)) {
      const normalized = specifier.replaceAll('\\', '/')
      if (
        normalized === '@eve-space/api' ||
        normalized.startsWith('@eve-space/api/') ||
        /(?:^|\/)api\/src(?:\/|$)/.test(normalized)
      )
        violations.push(`${path}: feature server code cannot import core API source ${specifier}`)
    }
  }
  return violations.toSorted((left, right) => left.localeCompare(right))
}
