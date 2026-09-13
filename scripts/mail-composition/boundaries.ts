import { posix } from 'node:path'
import { typescriptModuleSpecifiers } from '../typescript-module-specifiers.js'
import { typescriptSourceScripts } from '../typescript-source-scripts.js'

const compositionModules = {
  draft: 'app/composables/mail-composition-draft.ts',
  facade: 'app/composables/useMailComposition.ts',
  submission: 'app/composables/mail-composition-submission.ts',
  utility: 'app/utils/mail-composition.ts',
} as const

const allowedCompositionImports: Record<string, ReadonlySet<string>> = {
  [compositionModules.draft]: new Set([compositionModules.utility]),
  [compositionModules.facade]: new Set([
    compositionModules.draft,
    compositionModules.submission,
    compositionModules.utility,
  ]),
  [compositionModules.submission]: new Set([compositionModules.draft, compositionModules.utility]),
  [compositionModules.utility]: new Set(),
}

export interface MailCompositionSource {
  readonly path: string
  readonly source: string
}

export function mailCompositionImportViolations(sources: readonly MailCompositionSource[]) {
  const paths = new Set(sources.map(({ path }) => normalizePath(path)))
  const violations = Object.values(compositionModules).flatMap((path) =>
    paths.has(path) ? [] : [`Mail composition module ${path} is missing`],
  )

  for (const source of sources) {
    const sourcePath = normalizePath(source.path)
    const specifiers = typescriptSourceScripts(sourcePath, source.source).flatMap((script) =>
      typescriptModuleSpecifiers(sourcePath, script),
    )
    for (const specifier of specifiers) {
      const importedPath = resolveImport(sourcePath, specifier)
      if (!importedPath || !Object.values(compositionModules).includes(importedPath as never))
        continue
      if (allowedCompositionImports[sourcePath]?.has(importedPath)) continue
      if (!(sourcePath in allowedCompositionImports) && importedPath === compositionModules.facade)
        continue
      violations.push(`${sourcePath}: cannot import mail composition module ${importedPath}`)
    }
  }

  return violations.toSorted((left, right) => left.localeCompare(right))
}

function resolveImport(sourcePath: string, specifier: string) {
  if (!specifier.startsWith('.')) return
  const resolved = posix.normalize(posix.join(posix.dirname(sourcePath), specifier))
  return posix.extname(resolved) ? resolved : `${resolved}.ts`
}

function normalizePath(path: string) {
  return path.replaceAll('\\', '/')
}
