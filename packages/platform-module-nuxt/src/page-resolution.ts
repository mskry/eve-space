import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { findPath } from '@nuxt/kit'
import { isPathInside } from './path-containment.js'

export async function resolveFeaturePage(packageRoot: string, pageFile: string, identity: string) {
  const pagesRoot = resolve(packageRoot, 'src/runtime/app/pages')
  const candidate = resolve(packageRoot, pageFile)
  const boundaryError = `Nuxt page ${identity} must remain under src/runtime/app/pages`
  if (!isPathInside(pagesRoot, candidate)) throw new Error(boundaryError)
  const resolvedFile = await findPath(candidate, { alias: {}, extensions: [] })
  if (!resolvedFile) throw new Error(`Nuxt page ${identity} is missing ${pageFile}`)
  const file = await realpath(resolvedFile)
  if (!isPathInside(await realpath(pagesRoot), file)) throw new Error(boundaryError)
  return file
}
