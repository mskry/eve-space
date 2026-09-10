import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { declaredQueueModules, queueBoundaryViolations } from '../../scripts/queue/boundaries'
import { loadQueueSources } from '../../scripts/queue/sources'

const forbiddenTierImports = [
  ['namespaces', 'representation', 'bullmq-producer', 'adapter'],
  ['namespaces', 'representation', 'affiliation-planner', 'application'],
  ['namespaces', 'representation', 'planner', 'orchestration'],
  ['namespaces', 'representation', 'platform', 'execution'],
  ['namespaces', 'representation', 'status', 'observability'],
  ['bullmq-producer', 'adapter', 'affiliation-planner', 'application'],
  ['bullmq-producer', 'adapter', 'planner', 'orchestration'],
  ['bullmq-producer', 'adapter', 'platform', 'execution'],
  ['bullmq-producer', 'adapter', 'status', 'observability'],
  ['affiliation-planner', 'application', 'bullmq-producer', 'adapter'],
  ['affiliation-planner', 'application', 'planner', 'orchestration'],
  ['affiliation-planner', 'application', 'platform', 'execution'],
  ['planner', 'orchestration', 'bullmq-producer', 'adapter'],
  ['planner', 'orchestration', 'platform', 'execution'],
  ['planner', 'orchestration', 'status', 'observability'],
  ['status', 'observability', 'affiliation-planner', 'application'],
  ['status', 'observability', 'planner', 'orchestration'],
  ['status', 'observability', 'platform', 'execution'],
] as const

describe('queue module boundaries', () => {
  it.each(forbiddenTierImports)(
    'rejects %s (%s) importing %s (%s)',
    (sourceModule, sourceTier, importedModule, importedTier) => {
      expect(sourcesWithImport(sourceModule, `./${importedModule}.js`)).toEqual([
        `api/src/queue/${sourceModule}.ts: ${sourceTier} module ${sourceModule} cannot import ${importedTier} module ${importedModule}`,
      ])
    },
  )

  it.each([
    'bullmq',
    '../db/client.js',
    '../domain-events/handlers.js',
    '../organization/owner-evidence.js',
    './job-handlers.js',
  ])('rejects the job contract importing non-contract dependency %s', (specifier) => {
    expect(sourcesWithImport('job-contracts', specifier)).toEqual([
      `api/src/queue/job-contracts.ts: Job contract module cannot import non-contract dependency ${specifier}`,
    ])
  })

  it.each([
    'node:crypto',
    'zod',
    '../characters/affiliation-contract.js',
    '../env.js',
    '../platform/collection-state.js',
    '../platform/resource-batch-contract.js',
  ])('allows reviewed job contract dependency %s', (specifier) => {
    expect(sourcesWithImport('job-contracts', specifier)).toEqual([])
  })

  it('rejects direct queue dependencies on ESI resilience', () => {
    expect(sourcesWithImport('planner', '../esi-resilience/layer.js')).toEqual([
      'api/src/queue/planner.ts: Queue module planner cannot import ESI resilience module ../esi-resilience/layer.js',
    ])
  })

  it('rejects dependency cycles', () => {
    const sources = declaredQueueModules.map((module) => {
      if (module === 'namespaces') return source(module, "import './outcomes.js'")
      if (module === 'outcomes') return source(module, "import './namespaces.js'")
      return source(module, '')
    })

    expect(queueBoundaryViolations(sources)).toEqual([
      'Queue dependency cycle: namespaces -> outcomes -> namespaces',
    ])
  })

  it('requires every source module to have one declared tier', () => {
    expect(
      queueBoundaryViolations([...declaredSources(), source('nested/new-module', '')]),
    ).toEqual([
      'api/src/queue/nested/new-module.ts: Queue module nested/new-module has no declared tier',
    ])
  })

  it('requires every declared module to have one source file', () => {
    expect(
      queueBoundaryViolations(declaredSources().filter(({ path }) => !path.endsWith('/status.ts'))),
    ).toEqual(['Declared queue module status has no source file'])
    expect(queueBoundaryViolations([...declaredSources(), source('status', '')])).toEqual([
      'Queue module status has 2 source files',
    ])
  })

  it('loads queue sources recursively', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eve-space-queue-sources-'))
    const nested = join(root, 'api', 'src', 'queue', 'nested')
    try {
      await mkdir(nested, { recursive: true })
      await writeFile(join(nested, 'example.ts'), 'export const example = true\n')

      await expect(loadQueueSources(root)).resolves.toEqual([
        {
          path: join('api', 'src', 'queue', 'nested', 'example.ts'),
          source: 'export const example = true\n',
        },
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

function sourcesWithImport(sourceModule: string, specifier: string) {
  return queueBoundaryViolations(
    declaredQueueModules.map((module) =>
      source(module, module === sourceModule ? `import '${specifier}'` : ''),
    ),
  )
}

function declaredSources() {
  return declaredQueueModules.map((module) => source(module, ''))
}

function source(module: string, contents: string) {
  return { path: `api/src/queue/${module}.ts`, source: contents }
}
