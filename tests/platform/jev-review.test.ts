// @vitest-environment node
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runGit } from '../../scripts/jev/git'
import {
  changedRepositoryFiles,
  mergeBaseRevision,
  repositoryFileAtRevision,
} from '../../scripts/jev/changed-files'
import { createJevClient, evaluateSystemOne } from '../../scripts/jev/client'
import { runJevReview, type JevReviewVerdict } from '../../scripts/jev/review'

const originalApiKey = process.env.TYPESAFE_API_KEY

afterEach(() => {
  if (originalApiKey === undefined) {
    delete process.env.TYPESAFE_API_KEY
  } else {
    process.env.TYPESAFE_API_KEY = originalApiKey
  }
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('Jev review change discovery', () => {
  it('keeps temporary Git repositories isolated from hook environment variables', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eve-space-jev-review-'))
    const foreign = join(root, 'foreign')
    const fixture = join(root, 'fixture')

    try {
      await mkdir(foreign)
      await mkdir(fixture)
      await runGit(foreign, 'init')
      vi.stubEnv('GIT_DIR', join(foreign, '.git'))
      vi.stubEnv('GIT_WORK_TREE', foreign)
      vi.stubEnv('GIT_INDEX_FILE', join(foreign, '.git', 'index'))

      await runGit(fixture, 'init')
      await writeFile(join(fixture, 'mapping.ts'), 'export const version = 1\n')
      await runGit(fixture, 'add', 'mapping.ts')
      await runGit(
        fixture,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        'commit',
        '-m',
        'fixture',
      )

      expect((await runGit(fixture, 'rev-parse', '--show-toplevel')).stdout.trim()).toBe(
        await realpath(fixture),
      )
      expect((await runGit(foreign, 'ls-files')).stdout.trim()).toBe('')
      await expect(changedRepositoryFiles(fixture, 'HEAD')).resolves.toStrictEqual([])
    } finally {
      vi.unstubAllEnvs()
      await rm(root, { force: true, recursive: true })
    }
  })

  it('includes staged and non-ignored untracked files and reads the base revision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eve-space-jev-review-'))

    try {
      await runGit(root, 'init')
      await mkdir(join(root, 'app'), { recursive: true })
      await writeFile(join(root, 'app', 'baseline.ts'), 'export const baseline = true\n')
      await runGit(root, 'add', '.')
      await runGit(
        root,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        'commit',
        '-m',
        'baseline',
      )

      await writeFile(join(root, 'app', 'staged.ts'), 'export const staged = true\n')
      await runGit(root, 'add', 'app/staged.ts')
      await mkdir(join(root, 'layers'), { recursive: true })
      await writeFile(join(root, 'layers/untracked.vue'), '<template><main /></template>\n')

      await expect(changedRepositoryFiles(root, 'HEAD')).resolves.toStrictEqual([
        'app/staged.ts',
        'layers/untracked.vue',
      ])
      await expect(repositoryFileAtRevision(root, 'HEAD', 'app/baseline.ts')).resolves.toContain(
        'baseline = true',
      )
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('reads previous sources from the merge base after the base branch advances', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eve-space-jev-review-'))
    const git = (...args: string[]) =>
      runGit(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args)

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

      await expect(changedRepositoryFiles(root, 'main')).resolves.toStrictEqual([])
      await expect(repositoryFileAtRevision(root, revision, 'mapping.ts')).resolves.toBe(
        'export const version = 1\n',
      )
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})

describe('Jev client', () => {
  it('retries an overloaded response and returns typed answers', async () => {
    process.env.TYPESAFE_API_KEY = 'test-key'
    vi.useFakeTimers()
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('busy', { status: 529 }))
      .mockResolvedValueOnce(Response.json({ answers: { fit: { noul: 0.9, type: 'noul' } } }))

    const evaluation = evaluateSystemOne(
      createJevClient(),
      { source: 'example' },
      {
        fit: { instructions: 'Does this fit?', type: 'noul' },
      },
    )
    await vi.runAllTimersAsync()

    await expect(evaluation).resolves.toStrictEqual({ fit: { noul: 0.9, type: 'noul' } })
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
          fit: { instructions: 'Does this fit?', type: 'noul' },
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
      classify: (state, judgment) => ({
        verdict: judgment,
        location: `${state}-candidate`,
        details: [`state: ${state}`],
        reason: `${state} reason`,
      }),
      concurrency: 2,
      findingName: 'test seam',
      judge: async (verdict) => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await new Promise((resolve) => setTimeout(resolve, verdict === 'pass' ? 4 : 1))
        active -= 1
        return verdict
      },
      reviewedName: 'candidate(s)',
      states: verdicts,
    })

    expect(maximumActive).toBe(2)
    expect(result.findings.map(({ verdict }) => verdict)).toStrictEqual(verdicts)
    expect(result.output).not.toContain('[PASS]')
    expect(result.output).toContain('[REVIEW] review-candidate')
    expect(result.output).toContain('state: report')
    expect(result.failed).toBe(true)
  })

  it('does not fail for review-only findings', async () => {
    const result = await runJevReview({
      classify: (state, judgment) => ({
        verdict: judgment,
        location: state,
        reason: 'Needs review',
      }),
      findingName: 'test seam',
      judge: async (verdict) => verdict,
      reviewedName: 'candidate(s)',
      states: ['review' as const],
    })

    expect(result.failed).toBe(false)
  })

  it('does not call Jev and returns a clean summary when there are no states', async () => {
    const judge = vi.fn()
    const result = await runJevReview({
      classify: () => ({ verdict: 'pass', location: '', reason: '' }),
      findingName: 'test seam',
      judge,
      reviewedName: 'candidate(s)',
      states: [],
    })

    expect(judge).not.toHaveBeenCalled()
    expect(result.output).toBe('No test seam findings across 0 reviewed candidate(s).')
    expect(result.failed).toBe(false)
  })
})
