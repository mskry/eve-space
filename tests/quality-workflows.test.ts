import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { apiCoverageThresholdScopes } from '../api/vitest.coverage-thresholds'
import { coverageThresholdScopes } from '../scripts/coverage-thresholds'
import { readWorkspaceFile as source } from './support/read-workspace-file'

interface WorkflowStep {
  readonly env?: Record<string, string>
  readonly if?: string
  readonly name: string
  readonly run?: string
  readonly uses?: string
  readonly with?: Record<string, string>
}

interface Workflow {
  readonly jobs: Record<string, { readonly steps: WorkflowStep[] }>
}

const continuousIntegration = parse(source('.github/workflows/ci.yml')) as Workflow
const coverage = parse(source('.github/workflows/coverage.yml')) as Workflow
const esiClient = parse(source('.github/workflows/esi-client.yml')) as Workflow
const rustToolchain = tomlSection(source('rust-toolchain.toml'), 'toolchain')
const sonarTrustCondition =
  "(github.event_name == 'push' || github.event.pull_request.head.repo.fork == false) && github.actor != 'dependabot[bot]'"

describe('repository quality workflow contracts', () => {
  it('runs dead-code and pinned Rust quality gates in trusted CI', () => {
    expect(workflowStep(continuousIntegration, 'quality', 'Check dead code').run).toBe('pnpm knip')

    const setupRust = workflowStep(continuousIntegration, 'rust', 'Set up pinned Rust toolchain')
    expect(setupRust.uses).toBe('actions-rust-lang/setup-rust-toolchain@v2')
    expect(setupRust.with?.['cache-workspaces']).toBe('sde-ingest -> target')
    expect(
      normalizeCommand(workflowStep(continuousIntegration, 'rust', 'Check Rust formatting')),
    ).toBe('cargo fmt --all --manifest-path sde-ingest/Cargo.toml -- --check')
    expect(normalizeCommand(workflowStep(continuousIntegration, 'rust', 'Lint Rust'))).toBe(
      'cargo clippy --locked --manifest-path sde-ingest/Cargo.toml --all-targets --all-features -- -D warnings',
    )
    expect(normalizeCommand(workflowStep(continuousIntegration, 'rust', 'Run Rust tests'))).toBe(
      'cargo test --locked --manifest-path sde-ingest/Cargo.toml --all-features',
    )
    expect(rustToolchain).toEqual({
      channel: '1.89.0',
      components: ['clippy', 'rustfmt'],
      profile: 'minimal',
    })
  })

  it('requires root Sonar credentials for trusted events and skips untrusted analysis', () => {
    const requireToken = workflowStep(coverage, 'coverage', 'Require root Sonar token')
    const analyze = workflowStep(coverage, 'coverage', 'Analyze with SonarQube Cloud')

    expect(requireToken.if).toBe(analyze.if)
    expect(normalizeExpression(requireToken.if)).toBe(sonarTrustCondition)
    expect(requireToken.env?.SONAR_TOKEN).toBe('${{ secrets.SONAR_TOKEN }}')
    expect(requireToken.run).toContain(
      '::error::SONAR_TOKEN is required for trusted root Sonar analysis.',
    )
    expect(requireToken.run).toContain('exit 1')
    expect(analyze.uses).toBe('SonarSource/sonarqube-scan-action@v8')
    expect(analyze.env?.SONAR_TOKEN).toBe('${{ secrets.SONAR_TOKEN }}')
  })

  it('applies the same trust boundary to ESI client analysis', () => {
    const requireToken = workflowStep(esiClient, 'analysis', 'Require ESI client Sonar token')
    const analyze = workflowStep(esiClient, 'analysis', 'Analyze ESI client with SonarQube Cloud')

    expect(requireToken.if).toBe(analyze.if)
    expect(normalizeExpression(requireToken.if)).toBe(sonarTrustCondition)
    expect(requireToken.env?.ESI_CLIENT_SONAR_TOKEN).toBe('${{ secrets.ESI_CLIENT_SONAR_TOKEN }}')
    expect(analyze.env?.SONAR_TOKEN).toBe('${{ secrets.ESI_CLIENT_SONAR_TOKEN }}')
  })

  it('keeps every critical per-file coverage threshold bound to a source file', () => {
    const scopes = { ...coverageThresholdScopes, ...apiCoverageThresholdScopes }
    for (const { root, thresholds } of Object.values(scopes)) {
      for (const path of Object.keys(thresholds)) {
        expect(existsSync(resolve(process.cwd(), root, path)), `${root}/${path}`).toBe(true)
      }
    }
  })
})

function workflowStep(workflow: Workflow, job: string, name: string) {
  const step = workflow.jobs[job]?.steps.find((candidate) => candidate.name === name)
  if (!step) throw new Error(`Missing ${job} workflow step: ${name}`)
  return step
}

function normalizeCommand(step: WorkflowStep) {
  return step.run?.replace(/\s+/g, ' ').trim()
}

function normalizeExpression(value: string | undefined) {
  return value?.replace(/\s+/g, ' ').trim()
}

function tomlSection(content: string, expectedSection: string) {
  const values: Record<string, unknown> = {}
  let section = ''

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1)
      continue
    }
    if (section !== expectedSection) continue

    const separator = line.indexOf('=')
    if (separator < 1) throw new Error(`Invalid TOML entry: ${line}`)
    values[line.slice(0, separator).trim()] = JSON.parse(line.slice(separator + 1).trim())
  }

  return values
}
