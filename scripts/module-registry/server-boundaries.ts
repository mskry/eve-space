export interface ModuleServerSource {
  readonly path: string
  readonly source: string
}

export function moduleServerImportViolations(sources: readonly ModuleServerSource[]) {
  const violations: string[] = []
  for (const { path, source } of sources) {
    const specifiers = [
      ...source.matchAll(
        /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
      ),
      ...source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((match) => match[1]!)

    for (const specifier of specifiers) {
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
