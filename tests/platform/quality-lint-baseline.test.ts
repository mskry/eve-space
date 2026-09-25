import { describe, expect, it } from 'vitest'
import {
  baselineChanges,
  findingCounts,
  isQualityLintCode,
  lintFinding,
  replaceBaselineRule,
  type LintDiagnostic,
} from '../../scripts/quality-lint-baseline'

const diagnostic = (source: Buffer, line: number, start = 0): LintDiagnostic => ({
  code: 'anti-slop(require-safety-comment-for-type-assertion)',
  filename: 'api/src/example.ts',
  labels: [
    { span: { length: 'as string'.length, line, offset: source.indexOf('as string', start) } },
  ],
  message: 'Type assertion needs a safety justification',
})

describe('quality lint baseline', () => {
  it('tracks anti-slop and cognitive complexity without baselining other lint rules', () => {
    expect(isQualityLintCode('anti-slop(no-runtime-typeof)')).toBe(true)
    expect(isQualityLintCode('complexity(complexity)')).toBe(true)
    expect(isQualityLintCode('eslint(sort-keys)')).toBe(false)
  })

  it('keeps existing findings stable when their line numbers move', () => {
    const original = Buffer.from('const value = input as string\n')
    const shifted = Buffer.from('\nconst value = input as string\n')
    const expected = findingCounts([lintFinding(diagnostic(original, 1), original)])
    const current = findingCounts([lintFinding(diagnostic(shifted, 2), shifted)])

    expect(baselineChanges(current, expected)).toStrictEqual([])
  })

  it('detects another copy of the same violation and retired baseline entries', () => {
    const original = Buffer.from('const value = input as string\n')
    const duplicated = Buffer.from('const value = input as string\nconst value = input as string\n')
    const finding = lintFinding(diagnostic(original, 1), original)
    const expected = findingCounts([finding])
    const current = findingCounts([
      lintFinding(diagnostic(duplicated, 1), duplicated),
      lintFinding(diagnostic(duplicated, 2, duplicated.indexOf('\n') + 1), duplicated),
    ])

    expect(baselineChanges(current, expected)).toStrictEqual([
      { actual: 2, allowed: 1, id: finding.id },
    ])
    expect(baselineChanges(new Map(), expected)).toStrictEqual([
      { actual: 0, allowed: 1, id: finding.id },
    ])
  })

  it('rejects a different violation even when the total count stays the same', () => {
    const original = Buffer.from('const value = input as string\n')
    const replacement = Buffer.from('const other = input as string\n')
    const previous = lintFinding(diagnostic(original, 1), original)
    const next = lintFinding(diagnostic(replacement, 1), replacement)

    expect(baselineChanges(findingCounts([next]), findingCounts([previous]))).toStrictEqual(
      [
        { actual: 0, allowed: 1, id: previous.id },
        { actual: 1, allowed: 0, id: next.id },
      ].toSorted((left, right) => left.id.localeCompare(right.id)),
    )
  })

  it('updates one rule without changing other baseline entries', () => {
    const existing = new Map([
      ['api/example.ts:anti-slop(no-known-value-widening):old', 2],
      ['api/example.ts:anti-slop(no-unknown-returns):other', 1],
    ])
    const current = new Map([['api/example.ts:anti-slop(no-known-value-widening):new', 1]])

    expect(
      replaceBaselineRule(current, existing, 'anti-slop(no-known-value-widening)'),
    ).toStrictEqual(
      new Map([
        ['api/example.ts:anti-slop(no-unknown-returns):other', 1],
        ['api/example.ts:anti-slop(no-known-value-widening):new', 1],
      ]),
    )
  })
})
