import { isAbsolute, relative, sep } from 'node:path'

export function isPathInside(root: string, path: string) {
  const target = relative(root, path)
  return target !== '' && target !== '..' && !target.startsWith(`..${sep}`) && !isAbsolute(target)
}
