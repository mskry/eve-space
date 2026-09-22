import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export async function changedRepositoryFiles(root: string, base: string) {
  const [branch, workingTree, staged, untracked] = await Promise.all([
    run('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: root }),
    run('git', ['diff', '--name-only'], { cwd: root }),
    run('git', ['diff', '--cached', '--name-only'], { cwd: root }),
    run('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root }),
  ])

  return [
    ...new Set(
      [branch.stdout, workingTree.stdout, staged.stdout, untracked.stdout].flatMap((output) =>
        output.split('\n'),
      ),
    ),
  ]
    .map((file) => file.trim())
    .filter(Boolean)
}

export async function mergeBaseRevision(root: string, base: string) {
  return (await run('git', ['merge-base', base, 'HEAD'], { cwd: root })).stdout.trim()
}

export async function repositoryFileAtRevision(root: string, revision: string, file: string) {
  try {
    return (await run('git', ['show', `${revision}:${file}`], { cwd: root })).stdout
  } catch {
    return ''
  }
}
