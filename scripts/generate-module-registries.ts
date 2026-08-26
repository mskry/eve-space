import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertOutputPath,
  generateRegistryFiles,
  generatedRegistryPaths,
  loadInstalledModuleManifests,
} from './module-registry/generator.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.argv[2]

if (mode !== '--write' && mode !== '--check')
  throw new Error('Usage: generate-module-registries.ts --write|--check')

const manifests = await loadInstalledModuleManifests(root)
const files = generateRegistryFiles(manifests)

if (mode === '--write') {
  for (const [path, content] of files) writeAtomically(assertOutputPath(root, path), content)
  console.log(`Generated ${files.size} platform module registries`)
} else {
  const stale: string[] = []
  for (const path of generatedRegistryPaths) {
    const checkedInPath = assertOutputPath(root, path)
    let actual: string | undefined
    try {
      actual = readFileSync(checkedInPath, 'utf8')
    } catch {
      actual = undefined
    }
    if (actual !== (files.get(path) ?? '')) stale.push(relative(root, checkedInPath))
  }
  if (stale.length > 0)
    throw new Error(
      `Generated platform registries are stale: ${stale.join(', ')}. Run pnpm registry:generate.`,
    )
  console.log(`Verified ${files.size} platform module registries`)
}

function writeAtomically(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp-${process.pid}`
  writeFileSync(temporaryPath, content, 'utf8')
  renameSync(temporaryPath, path)
}
