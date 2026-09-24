// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { collectPlatformContractEvidence } from '../../scripts/platform-contract-review/evidence'
import { classifyPlatformContract } from '../../scripts/platform-contract-review/findings'
import type { PlatformContractJudgment } from '../../scripts/platform-contract-review/judgments'

const judgment = (overrides: Partial<PlatformContractJudgment> = {}): PlatformContractJudgment => ({
  audienceFit: { choice: 'aligned', confidence: 0.95 },
  permissionFit: { choice: 'aligned', confidence: 0.95 },
  purposeFit: { choice: 'aligned', confidence: 0.95 },
  sensitivityFit: { choice: 'aligned', confidence: 0.95 },
  targetFit: { choice: 'aligned', confidence: 0.95 },
  ...overrides,
})

describe('platform contract evidence', () => {
  it('binds a changed manifest route to its semantic declarations and implementation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eve-space-platform-contract-'))
    const repository = pathToFileURL(`${root}/`)
    try {
      await mkdir(join(root, 'features/example/server/src'), { recursive: true })
      await mkdir(join(root, 'api/src/platform'), { recursive: true })
      await writeFile(
        join(root, 'features/example/module.config.ts'),
        `
const manifest = {
  id: 'example',
  permissions: [{ key: 'example.secret.read', label: 'Read secret', purpose: 'Read secret evidence.', audiences: ['hr'], sensitivity: 'sensitive' }],
  reviewerContributions: [{ id: 'secret', routeId: 'secret-detail', target: 'managed-organization-character', audience: 'hr', requiredPermission: 'example.secret.read', label: 'Secret', description: 'Review secret evidence.' }],
  sections: [{ id: 'secret', kind: 'sensitive-evidence', defaultEnabled: false, disclosureRevision: 1 }],
  server: { routes: [{ id: 'secret-detail', namespace: '/example/:userId/:characterId', exportName: 'secretRoutes', authorization: 'authenticated-session', audience: 'hr', requiredPermission: 'example.secret.read', sectionId: 'secret', target: 'managed-organization-character', exposure: 'sensitive-evidence' }] }
}
`,
      )
      await writeFile(
        join(root, 'features/example/server/src/routes.ts'),
        `export function secretRoutes() { return app.get('/', (context) => context.json({ secret: context.var.platform.evidence.read() })) }\n`,
      )
      await writeFile(
        join(root, 'api/src/platform/module-route-composition.ts'),
        `
export function composePlatformReviewerContributionRoute() { return composeReviewerTargetModuleRoute() }
function composeReviewerTargetModuleRoute() { return requireModuleReviewerAuthorization() }
`,
      )

      const evidence = await collectPlatformContractEvidence(repository, root, [
        'features/example/module.config.ts',
      ])

      expect(evidence).toHaveLength(1)
      expect(evidence[0]).toMatchObject({
        id: 'example:secret-detail',
        implementation: { file: 'features/example/server/src/routes.ts', line: 1 },
        route: {
          exposure: 'sensitive-evidence',
          requiredPermission: 'example.secret.read',
          target: 'managed-organization-character',
        },
      })
      expect(evidence[0].permission).toContain('Read secret evidence')
      expect(evidence[0].section).toContain('sensitive-evidence')
      expect(evidence[0].reviewerContribution).toContain('Review secret evidence')
      expect(evidence[0].composition).toContain('requireModuleReviewerAuthorization')
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})

describe('platform contract finding classification', () => {
  const evidence = {
    composition: 'composer',
    id: 'example:secret-detail',
    implementation: { code: 'route', file: 'features/example/server/src/routes.ts', line: 4 },
    manifestFile: 'features/example/module.config.ts',
    manifestLine: 10,
    moduleId: 'example',
    permission: '{}',
    reviewerContribution: '{}',
    route: {
      audience: 'hr',
      authorization: 'authenticated-session',
      code: '{}',
      exportName: 'secretRoutes',
      exposure: 'sensitive-evidence',
      id: 'secret-detail',
      namespace: '/example/:userId/:characterId',
      requiredPermission: 'example.secret.read',
      sectionId: 'secret',
      target: 'managed-organization-character',
    },
    section: '{}',
  } as const

  it('passes a confident aligned route', () => {
    expect(classifyPlatformContract(evidence, judgment()).verdict).toBe('pass')
  })

  it.each([
    ['purposeFit', { choice: 'mismatch', confidence: 0.95 }],
    ['audienceFit', { choice: 'overbroad', confidence: 0.95 }],
    ['permissionFit', { choice: 'under_scoped', confidence: 0.95 }],
    ['targetFit', { choice: 'mismatch', confidence: 0.95 }],
    ['sensitivityFit', { choice: 'underclassified', confidence: 0.95 }],
  ] as const)('reports a high-confidence %s security mismatch', (signal, value) => {
    expect(classifyPlatformContract(evidence, judgment({ [signal]: value })).verdict).toBe('report')
  })

  it('routes an unclear judgment to human review', () => {
    const result = classifyPlatformContract(
      evidence,
      judgment({ targetFit: { choice: 'unclear', confidence: 0.9 } }),
    )
    expect(result.verdict).toBe('review')
    expect(result.reason).toContain('target=unclear')
  })

  it('keeps a non-security sensitivity inconsistency advisory', () => {
    const result = classifyPlatformContract(
      evidence,
      judgment({ sensitivityFit: { choice: 'inconsistent', confidence: 0.95 } }),
    )
    expect(result.verdict).toBe('review')
  })

  it('does not automatically pass a low-confidence aligned judgment', () => {
    const result = classifyPlatformContract(
      evidence,
      judgment({ audienceFit: { choice: 'aligned', confidence: 0.3 } }),
    )
    expect(result.verdict).toBe('review')
  })
})
