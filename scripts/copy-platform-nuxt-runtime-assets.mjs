import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(repositoryRoot, 'packages/platform-module-nuxt/src/runtime/app/components')
const destination = resolve(
  repositoryRoot,
  'packages/platform-module-nuxt/dist/runtime/app/components',
)

rmSync(destination, { recursive: true, force: true })
mkdirSync(dirname(destination), { recursive: true })
cpSync(source, destination, { recursive: true })
