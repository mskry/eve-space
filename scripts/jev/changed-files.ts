import { runGit } from './git.js'

export async function changedRepositoryFiles(root: string, base: string) {
  const [branch, workingTree, staged, untracked] = await Promise.all([
    runGit(root, 'diff', '--name-only', `${base}...HEAD`),
    runGit(root, 'diff', '--name-only'),
    runGit(root, 'diff', '--cached', '--name-only'),
    runGit(root, 'ls-files', '--others', '--exclude-standard'),
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
  return (await runGit(root, 'merge-base', base, 'HEAD')).stdout.trim()
}

export async function repositoryFileAtRevision(root: string, revision: string, file: string) {
  try {
    return (await runGit(root, 'show', `${revision}:${file}`)).stdout
  } catch {
    return ''
  }
}
