import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function readWorkspaceFile(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}
