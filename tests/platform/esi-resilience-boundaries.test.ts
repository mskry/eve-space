import { describe, expect, it } from 'vitest'
import { esiResilienceImportViolations } from '../../scripts/esi-resilience/boundaries'

describe('ESI resilience module boundaries', () => {
  it.each([
    ['numeric', 'support', 'timing', 'support'],
    ['numeric', 'support', 'types', 'representation'],
    ['numeric', 'support', 'catalog', 'contract'],
    ['numeric', 'support', 'cache-redis', 'infrastructure'],
    ['numeric', 'support', 'layer', 'execution'],
    ['numeric', 'support', 'telemetry', 'observability'],
    ['types', 'representation', 'cache-redis', 'infrastructure'],
    ['types', 'representation', 'layer', 'execution'],
    ['catalog', 'contract', 'cache-redis', 'infrastructure'],
    ['catalog', 'contract', 'layer', 'execution'],
    ['cache-redis', 'infrastructure', 'layer', 'execution'],
  ] as const)(
    'rejects %s (%s) importing %s (%s)',
    (sourceModule, sourceTier, importedModule, importedTier) => {
      expect(
        esiResilienceImportViolations([source(sourceModule, `import './${importedModule}.js'`)]),
      ).toEqual([
        `api/src/esi-resilience/${sourceModule}.ts: ${sourceTier} module ${sourceModule} cannot import ${importedTier} module ${importedModule}`,
      ])
    },
  )

  it('allows execution to record telemetry and observability to read execution state', () => {
    expect(
      esiResilienceImportViolations([
        source('resource-revision', "import { record } from './telemetry-counters.js'"),
        source('telemetry', "import { getCooldowns } from './cooldowns.js'"),
      ]),
    ).toEqual([])
  })

  it('requires new modules to declare their tier', () => {
    expect(esiResilienceImportViolations([source('new-module', '')])).toEqual([
      'api/src/esi-resilience/new-module.ts: ESI resilience module new-module has no declared tier',
    ])
  })
})

function source(module: string, contents: string) {
  return { path: `api/src/esi-resilience/${module}.ts`, source: contents }
}
