// @vitest-environment node
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  changedRepositoryFiles,
  mergeBaseRevision,
  repositoryFileAtRevision,
} from '../../scripts/jev/changed-files'
import { createJevClient, evaluateSystemOne } from '../../scripts/jev/client'
import { runJevReview, type JevReviewVerdict } from '../../scripts/jev/review'

const run = promisify(execFile)
const originalApiKey = process.env.TYPESAFE_API_KEY

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.TYPESAFE_API_KEY
  else process.env.TYPESAFE_API_KEY = originalApiKey
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Jev review change discovery', () => {
  it('includes staged and non-ignored untracked files and reads the base revision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eve-space-jev-review-'))

    try {
      await run('git', ['init'], { cwd: root })
      await mkdir(join(root, 'app'), { recursive: true })
      await writeFile(join(root, 'app', 'baseline.ts'), 'export const baseline = true\n')
      await run('git', ['add', '.'], { cwd: root })
      await run(
        'git',
        ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'baseline'],
        { cwd: root },
      )

      await writeFile(join(root, 'app', 'staged.ts'), 'export const staged = true\n')
      await run('git', ['add', 'app/staged.ts'], { cwd: root })
      await mkdir(join(root, 'layers'), { recursive: true })
      await writeFile(join(root, 'layers/untracked.vue'), '<template><main /></template>\n')

      await expect(changedRepositoryFiles(root, 'HEAD')).resolves.toEqual([
        'app/staged.ts',
        'layers/untracked.vue',
      ])
      await expect(repositoryFileAtRevision(root, 'HEAD', 'app/baseline.ts')).resolves.toContain(
        'baseline = true',
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reads previous sources from the merge base after the base branch advances', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eve-space-jev-review-'))
    const git = (...args: string[]) =>
      run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
        cwd: root,
      })

    try {
      await git('init', '--initial-branch=main')
      await writeFile(join(root, 'mapping.ts'), 'export const version = 1\n')
      await git('add', '.')
      await git('commit', '-m', 'branch point')
      await git('checkout', '-b', 'feature')
      await git('checkout', 'main')
      await writeFile(join(root, 'mapping.ts'), 'export const version = 2\n')
      await git('commit', '-am', 'advance main')
      await git('checkout', 'feature')

      const revision = await mergeBaseRevision(root, 'main')

      await expect(changedRepositoryFiles(root, 'main')).resolves.toEqual([])
      await expect(repositoryFileAtRevision(root, revision, 'mapping.ts')).resolves.toBe(
        'export const version = 1\n',
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('Jev client', () => {
  it('retries an overloaded response and returns typed answers', async () => {
    process.env.TYPESAFE_API_KEY = 'test-key'
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('busy', { status: 529 }))
      .mockResolvedValueOnce(Response.json({ answers: { fit: { type: 'noul', noul: 0.9 } } }))

    const evaluation = evaluateSystemOne(
      createJevClient(),
      { source: 'example' },
      {
        fit: { type: 'noul', instructions: 'Does this fit?' },
      },
    )
    await vi.runAllTimersAsync()

    await expect(evaluation).resolves.toEqual({ fit: { type: 'noul', noul: 0.9 } })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('rejects a response without answers', async () => {
    process.env.TYPESAFE_API_KEY = 'test-key'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ model: 'jev-latest' }))

    await expect(
      evaluateSystemOne(
        createJevClient(),
        {},
        {
          fit: { type: 'noul', instructions: 'Does this fit?' },
        },
      ),
    ).rejects.toThrow('did not contain an answers object')
  })
})

describe('Jev review runner', () => {
  it('bounds concurrency, preserves order, formats findings, and fails when a report exists', async () => {
    let active = 0
    let maximumActive = 0
    const verdicts: JevReviewVerdict[] = ['pass', 'review', 'report', 'pass']
    const result = await runJevReview({
      findingName: 'test seam',
      reviewedName: 'candidate(s)',
      states: verdicts,
      concurrency: 2,
      judge: async (verdict) => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await new Promise((resolve) => setTimeout(resolve, verdict === 'pass' ? 4 : 1))
        active -= 1
        return verdict
      },
      classify: (state, judgment) => ({
        verdict: judgment,
        location: `${state}-candidate`,
        details: [`state: ${state}`],
        reason: `${state} reason`,
      }),
    })

    expect(maximumActive).toBe(2)
    expect(result.findings.map(({ verdict }) => verdict)).toEqual(verdicts)
    expect(result.output).not.toContain('[PASS]')
    expect(result.output).toContain('[REVIEW] review-candidate')
    expect(result.output).toContain('state: report')
    expect(result.failed).toBe(true)
  })

  it('does not fail for review-only findings', async () => {
    const result = await runJevReview({
      findingName: 'test seam',
      reviewedName: 'candidate(s)',
      states: ['review' as const],
      judge: async (verdict) => verdict,
      classify: (state, judgment) => ({
        verdict: judgment,
        location: state,
        reason: 'Needs review',
      }),
    })

    expect(result.failed).toBe(false)
  })

  it('does not call Jev and returns a clean summary when there are no states', async () => {
    const judge = vi.fn()
    const result = await runJevReview({
      findingName: 'test seam',
      reviewedName: 'candidate(s)',
      states: [],
      judge,
      classify: () => ({ verdict: 'pass', location: '', reason: '' }),
    })

    expect(judge).not.toHaveBeenCalled()
    expect(result.output).toBe('No test seam findings across 0 reviewed candidate(s).')
    expect(result.failed).toBe(false)
  })
})
