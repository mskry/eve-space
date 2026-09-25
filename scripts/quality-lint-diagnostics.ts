import { spawnSync } from 'node:child_process'
import { extname } from 'node:path'
import { isQualityLintCode, type LintDiagnostic, type LintSpan } from './quality-lint-baseline.js'

const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null

const isSpan = (value: unknown): value is LintSpan =>
  isObject(value) &&
  'offset' in value &&
  typeof value.offset === 'number' &&
  'length' in value &&
  typeof value.length === 'number' &&
  'line' in value &&
  typeof value.line === 'number'

const hasSpan = (value: unknown): value is { span: LintSpan } =>
  isObject(value) && 'span' in value && isSpan(value.span)

const isQualityLintDiagnostic = (value: unknown): value is LintDiagnostic => {
  if (
    !isObject(value) ||
    !('code' in value) ||
    typeof value.code !== 'string' ||
    !isQualityLintCode(value.code)
  ) {
    return false
  }
  if (
    !('filename' in value) ||
    typeof value.filename !== 'string' ||
    !('message' in value) ||
    typeof value.message !== 'string' ||
    !('labels' in value) ||
    !Array.isArray(value.labels)
  ) {
    return false
  }
  const label: unknown = value.labels[0]
  return hasSpan(label)
}

export const scanQualityLintDiagnostics = (root: string): LintDiagnostic[] => {
  const pnpmPath = process.env.npm_execpath
  if (!pnpmPath) {
    throw new Error('Run the quality lint scan through pnpm')
  }
  const args = [
    'exec',
    'oxlint',
    '--config',
    'oxlint.ultracite.config.ts',
    '--disable-nested-config',
    '--format',
    'json',
    '.',
  ]
  const executable = ['.js', '.cjs', '.mjs'].includes(extname(pnpmPath))
    ? process.execPath
    : pnpmPath
  if (executable !== pnpmPath) {
    args.unshift(pnpmPath)
  }
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`Oxlint could not produce quality lint diagnostics: ${result.stderr}`)
  }
  const report: unknown = JSON.parse(result.stdout)
  if (!isObject(report) || !('diagnostics' in report) || !Array.isArray(report.diagnostics)) {
    throw new Error('Oxlint did not return diagnostics')
  }
  const diagnostics: unknown[] = report.diagnostics
  return diagnostics.filter(isQualityLintDiagnostic)
}
