import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  baselineChanges,
  findingCounts,
  lintFinding,
  parseFindingBaseline,
  replaceBaselineRule,
  type LintFinding,
} from './quality-lint-baseline.js'
import { scanQualityLintDiagnostics } from './quality-lint-diagnostics.js'

type QualityRule = 'anti-slop' | 'complexity'

const ruleKind = (code: string): QualityRule =>
  code.startsWith('anti-slop(') ? 'anti-slop' : 'complexity'

const checkBaseline = (
  kind: QualityRule,
  findings: readonly LintFinding[],
  update: boolean,
  selectedRule?: string,
) => {
  const baselinePath = fileURLToPath(new URL(`${kind}-baseline.json`, import.meta.url))
  const current = findingCounts(findings)

  if (update) {
    const updated = selectedRule
      ? replaceBaselineRule(
          current,
          parseFindingBaseline(readFileSync(baselinePath, 'utf-8')),
          selectedRule,
        )
      : current
    const ordered = [...updated].toSorted(([left], [right]) => left.localeCompare(right))
    writeFileSync(
      baselinePath,
      `${JSON.stringify({ findings: Object.fromEntries(ordered), version: 1 }, null, 2)}\n`,
    )
    console.log(`Recorded ${selectedRule ?? kind} findings`)
    return
  }

  const expected = parseFindingBaseline(readFileSync(baselinePath, 'utf-8'))
  const changes = baselineChanges(current, expected)
  if (changes.length > 0) {
    const details = changes.slice(0, 20).map(({ id, actual, allowed }) => {
      const finding = findings.find((candidate) => candidate.id === id)
      const location = finding ? `${finding.filename}:${finding.line} ${finding.rule}` : id
      const findingMessage = finding ? ` — ${finding.message}` : ''
      return `${location}: ${allowed} baselined, ${actual} current${findingMessage}`
    })
    throw new Error(
      `${changes.length} ${kind} baseline differences:\n${details.join('\n')}\nFix new findings or run pnpm lint:${kind}:baseline after reviewing removals.`,
    )
  }
  console.log(`Verified ${findings.length} baselined ${kind} findings; no new findings`)
}

const root = fileURLToPath(new URL('..', import.meta.url))
const mode = process.argv[2]
const update = process.argv[3] === '--write'
const selectedRule = process.argv[4]?.startsWith('--rule=')
  ? `anti-slop(${process.argv[4].slice('--rule='.length)})`
  : undefined

if (
  (mode !== 'all' && mode !== 'anti-slop' && mode !== 'complexity') ||
  (process.argv[3] && !update) ||
  (process.argv[4] && !selectedRule) ||
  (selectedRule &&
    (!update || mode !== 'anti-slop' || !/^anti-slop\([a-z]+(?:-[a-z]+)*\)$/.test(selectedRule))) ||
  process.argv[5]
) {
  throw new Error('Usage: check-quality-lint.ts all|anti-slop|complexity [--write [--rule=<name>]]')
}

const qualityDiagnostics = scanQualityLintDiagnostics(root)
const sources = new Map<string, Buffer>()
const findings = qualityDiagnostics.map((diagnostic) => {
  let source = sources.get(diagnostic.filename)
  if (!source) {
    source = readFileSync(resolve(root, diagnostic.filename))
    sources.set(diagnostic.filename, source)
  }
  return lintFinding(diagnostic, source)
})

const rules: QualityRule[] = mode === 'all' ? ['anti-slop', 'complexity'] : [mode]
for (const kind of rules) {
  checkBaseline(
    kind,
    findings.filter((finding) => ruleKind(finding.rule) === kind),
    update,
    selectedRule,
  )
}
