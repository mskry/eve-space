import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const runGit = async (root: string, ...args: string[]) => {
  const { stdout } = await run('git', ['rev-parse', '--local-env-vars'])
  const environment = { ...process.env }
  for (const name of stdout.trim().split('\n')) {
    delete environment[name]
  }
  return run('git', args, { cwd: root, env: environment })
}
