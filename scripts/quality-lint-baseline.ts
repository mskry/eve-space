import { createHash } from 'node:crypto'

export interface LintSpan {
  readonly length: number
  readonly line: number
  readonly offset: number
}

export interface LintDiagnostic {
  readonly code: string
  readonly filename: string
  readonly labels: readonly {
    readonly span: LintSpan
  }[]
  readonly message: string
}

export interface LintFinding {
  readonly id: string
  readonly line: number
  readonly filename: string
  readonly message: string
  readonly rule: string
}

export const isQualityLintCode = (code: string) =>
  code.startsWith('anti-slop(') || code === 'complexity(complexity)'

export const lintFinding = (diagnostic: LintDiagnostic, source: Buffer): LintFinding => {
  const span = diagnostic.labels[0]?.span
  if (!span || span.offset < 0 || span.offset + span.length > source.length) {
    throw new Error(`Quality lint diagnostic has no valid source span: ${diagnostic.filename}`)
  }

  const start = span.offset === 0 ? 0 : source.lastIndexOf(10, span.offset - 1) + 1
  const nextLine = source.indexOf(10, span.offset + span.length)
  const end = nextLine === -1 ? source.length : nextLine
  const text = source.subarray(start, end).toString('utf-8').trim().replaceAll(/\s+/gu, ' ')
  const hash = createHash('sha256').update(text).digest('hex')

  return {
    filename: diagnostic.filename,
    id: `${diagnostic.filename}:${diagnostic.code}:${hash}`,
    line: span.line,
    message: diagnostic.message,
    rule: diagnostic.code,
  }
}

export const findingCounts = (findings: readonly LintFinding[]) => {
  const counts = new Map<string, number>()
  for (const finding of findings) {
    counts.set(finding.id, (counts.get(finding.id) ?? 0) + 1)
  }
  return counts
}

export const replaceBaselineRule = (
  current: ReadonlyMap<string, number>,
  expected: ReadonlyMap<string, number>,
  rule: string,
) => {
  const marker = `:${rule}:`
  const updated = new Map([...expected].filter(([id]) => !id.includes(marker)))
  for (const [id, count] of current) {
    if (id.includes(marker)) {
      updated.set(id, count)
    }
  }
  return updated
}

export const parseFindingBaseline = (content: string) => {
  const saved: unknown = JSON.parse(content)
  if (
    !saved ||
    typeof saved !== 'object' ||
    !('version' in saved) ||
    saved.version !== 1 ||
    !('findings' in saved) ||
    !saved.findings ||
    typeof saved.findings !== 'object'
  ) {
    throw new Error('Quality lint baseline is invalid')
  }
  const counts = new Map<string, number>()
  for (const [id, count] of Object.entries(saved.findings)) {
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) {
      throw new Error(`Quality lint baseline has an invalid count: ${id}`)
    }
    counts.set(id, count)
  }
  return counts
}

export const baselineChanges = (
  current: ReadonlyMap<string, number>,
  expected: ReadonlyMap<string, number>,
) =>
  [...new Set([...current.keys(), ...expected.keys()])]
    .filter((id) => current.get(id) !== expected.get(id))
    .toSorted((left, right) => left.localeCompare(right))
    .map((id) => ({ actual: current.get(id) ?? 0, allowed: expected.get(id) ?? 0, id }))
