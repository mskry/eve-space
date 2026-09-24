import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveReviewerPanelFile } from '../src/reviewer-panel-resolution.js'

let root: string
let workspace: string

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'eve-reviewer-panel-'))
  root = join(workspace, 'package')
  await mkdir(join(root, 'dist/reviewer'), { recursive: true })
})

afterEach(async () => {
  await rm(workspace, { force: true, recursive: true })
})

describe('reviewer panel resolution', () => {
  it('accepts a regular resolved file inside the owning package', async () => {
    const panel = join(root, 'dist/reviewer/overview.js')
    await writeFile(panel, 'export default {}\n')

    await expect(resolveReviewerPanelFile(root, panel, 'alpha/overview')).resolves.toBe(
      await realpath(panel),
    )
  })

  it('rejects missing, non-file, and escaped targets without exposing filesystem paths', async () => {
    const outside = join(workspace, 'outside-panel.js')
    const escape = join(root, 'dist/reviewer/escape.js')
    await writeFile(outside, 'export default {}\n')
    await symlink(outside, escape)

    const attempts = [
      resolveReviewerPanelFile(root, join(root, 'missing.js'), 'alpha/missing'),
      resolveReviewerPanelFile(root, join(root, 'dist/reviewer'), 'alpha/directory'),
      resolveReviewerPanelFile(root, escape, 'alpha/escape'),
    ]
    const messages = await Promise.all(
      attempts.map(async (attempt) => {
        try {
          await attempt
          return ''
        } catch (error) {
          return error instanceof Error ? error.message : String(error)
        }
      }),
    )

    expect(messages).toStrictEqual([
      'Reviewer panel alpha/missing is missing its package export',
      'Reviewer panel alpha/directory must resolve to a regular file',
      'Reviewer panel alpha/escape must resolve within its owning Nuxt package',
    ])
    expect(messages.join('\n')).not.toContain(root)
  })
})
