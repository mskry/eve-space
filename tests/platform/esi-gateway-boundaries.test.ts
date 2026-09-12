import { describe, expect, it } from 'vitest'
import {
  esiGatewayConsumerImportViolations,
  esiGatewayImportViolations,
} from '../../scripts/esi-gateway/boundaries'

describe('ESI gateway boundaries', () => {
  it.each([
    ['internal/numeric', 'support', 'internal/types', 'representation'],
    ['internal/types', 'representation', 'internal/transport', 'infrastructure'],
    ['internal/catalog', 'contract', 'internal/execution-runtime', 'execution'],
    ['internal/catalog', 'contract', 'internal/request-lifecycle', 'execution'],
    ['internal/coordination', 'infrastructure', 'internal/execution-runtime', 'execution'],
    ['internal/identity', 'representation', 'internal/telemetry', 'aggregateObservability'],
    ['internal/catalog', 'contract', 'internal/telemetry', 'aggregateObservability'],
    ['internal/coordination', 'infrastructure', 'internal/telemetry', 'aggregateObservability'],
    ['internal/execution-runtime', 'execution', 'internal/telemetry', 'aggregateObservability'],
    [
      'internal/telemetry-counters',
      'recorderObservability',
      'internal/telemetry',
      'aggregateObservability',
    ],
    [
      'internal/rate-measurement',
      'recorderObservability',
      'internal/execution-runtime',
      'execution',
    ],
    ['internal/result-metadata', 'representation', 'internal/telemetry', 'aggregateObservability'],
  ] as const)(
    'rejects %s (%s) importing %s (%s)',
    (sourceModule, sourceTier, importedModule, importedTier) => {
      expect(
        esiGatewayImportViolations([source(sourceModule, `import './${last(importedModule)}.js'`)]),
      ).toEqual([
        `api/src/esi-gateway/${sourceModule}.ts: ${sourceTier} module ${sourceModule} cannot import ${importedTier} module ${importedModule}`,
      ])
    },
  )

  it('allows root interfaces to own their internal dependencies', () => {
    expect(
      esiGatewayImportViolations([
        source(
          'feature-execution',
          "import './internal/representation-registry.js'\nimport './internal/production-runtime.js'",
        ),
        source(
          'catalog-interface',
          "import './internal/catalog-access.js'\nimport './internal/catalog.js'",
        ),
        source('status-interface', "import './internal/telemetry.js'"),
      ]),
    ).toEqual([])
  })

  it('allows recording from lower tiers and aggregation of execution state', () => {
    expect(
      esiGatewayImportViolations([
        source('internal/identity', "import './telemetry-counters.js'"),
        source('internal/coordination', "import './telemetry-counters.js'"),
        source('internal/telemetry-counters', "import './catalog-access.js'"),
        source('internal/telemetry', "import './cooldowns.js'\nimport './telemetry-counters.js'"),
      ]),
    ).toEqual([])
  })

  it.each([
    ['internal/identity', '../../db/client.js', 'api/src/db/client'],
    ['internal/catalog', '../../auth/tokens.js', 'api/src/auth/tokens'],
    ['internal/identity', '../../cache-redis.js', 'api/src/cache-redis'],
    ['internal/identity', '../../db/../db/client.ts', 'api/src/db/client'],
    ['internal/coordination', '../../db/client.js', 'api/src/db/client'],
    ['internal/telemetry-counters', '../../db/client.js', 'api/src/db/client'],
    [
      'internal/identity',
      '../../generated/platform/installed-module-esi.js',
      'api/src/generated/platform/installed-module-esi',
    ],
    ['internal/identity', 'ioredis', 'ioredis'],
    ['internal/identity', 'node:net', 'node:net'],
    ['internal/identity', 'postgres', 'postgres'],
    ['internal/execution-runtime', 'effect', 'effect'],
    ['internal/request-lifecycle', 'effect/Effect', 'effect/Effect'],
    [
      'internal/identity',
      '@evespace/esi-client/domains/wallet',
      '@evespace/esi-client/domains/wallet',
    ],
  ])('rejects %s importing external dependency %s', (module, specifier, dependency) => {
    expect(esiGatewayImportViolations([source(module, `import '${specifier}'`)])).toEqual([
      `api/src/esi-gateway/${module}.ts: module ${module} cannot import external dependency ${dependency}`,
    ])
  })

  it.each([
    "export { db } from '../../db/client.js'",
    "const database = await import('../../db/client.js')",
    "import type { Database } from '../../db/client.js'",
  ])('rejects external dependencies through %s', (contents) => {
    expect(esiGatewayImportViolations([source('internal/identity', contents)])).toEqual([
      'api/src/esi-gateway/internal/identity.ts: module internal/identity cannot import external dependency api/src/db/client',
    ])
  })

  it('allows shared pure dependencies and explicit external adapters', () => {
    expect(
      esiGatewayImportViolations([
        source('internal/identity', "import '../../type-guards.js'\nimport 'node:crypto'"),
        source('internal/envelope', "import 'zod'"),
        source('internal/catalog', "import '../../generated/platform/installed-module-esi.js'"),
        source('catalog-interface', "import '../generated/platform/installed-module-esi.js'"),
        source('internal/coordination', "import type { Redis } from 'ioredis'"),
        source('internal/request-lifecycle', "import { Effect } from 'effect'"),
        source(
          'internal/production-runtime',
          "import '../../auth/tokens.js'\nimport '../../cache-redis.js'",
        ),
        source('internal/telemetry-counters', "import '../../cache-redis.js'"),
        source('internal/telemetry', "import '../../coordination-redis.js'"),
        source('status-interface', "import '../cache-redis.js'"),
      ]),
    ).toEqual([])
  })

  it('rejects dependency cycles', () => {
    expect(
      esiGatewayImportViolations([
        source('internal/numeric', "import './timing.js'"),
        source('internal/timing', "import './numeric.js'"),
      ]),
    ).toEqual([
      'api/src/esi-gateway/internal/numeric.ts: support module internal/numeric cannot import support module internal/timing',
      'api/src/esi-gateway/internal/timing.ts: support module internal/timing cannot import support module internal/numeric',
      'ESI gateway dependency cycle: internal/numeric -> internal/timing -> internal/numeric',
    ])
  })

  it('rejects unlisted modules', () => {
    expect(esiGatewayImportViolations([source('internal/new-module', '')])).toEqual([
      'api/src/esi-gateway/internal/new-module.ts: ESI gateway module internal/new-module has no declared tier',
    ])
  })

  it('reserves application configuration for the production composition root', () => {
    expect(
      esiGatewayImportViolations([
        source('internal/execution-runtime', "import '../../env.js'"),
        source('internal/envelope', "import '../../env.js'"),
        source('internal/production-runtime', "import '../../env.js'"),
      ]),
    ).toEqual([
      'api/src/esi-gateway/internal/envelope.ts: only the production runtime may import application configuration',
      'api/src/esi-gateway/internal/execution-runtime.ts: only the production runtime may import application configuration',
    ])
  })

  it('rejects direct implementation imports and incompatible consumer seams', () => {
    expect(
      esiGatewayConsumerImportViolations(
        [
          external(
            'api/src/characters/example.ts',
            "import '../esi-gateway/internal/execution-runtime.js'",
          ),
          external(
            'api/src/characters/lifecycle-example.ts',
            "import '../esi-gateway/internal/request-lifecycle.js'",
          ),
          external(
            'api/src/characters/example.ts',
            "import '../esi-gateway/platform-execution.js'",
          ),
        ],
        'core',
      ),
    ).toEqual([
      'api/src/characters/example.ts: core code cannot import ESI gateway internal modules',
      'api/src/characters/example.ts: core code cannot import ESI gateway platform execution',
      'api/src/characters/lifecycle-example.ts: core code cannot import ESI gateway internal modules',
    ])
    expect(
      esiGatewayConsumerImportViolations(
        [
          external(
            'features/example/server/src/index.ts',
            "import '../../../../api/src/esi-gateway/feature-execution.js'",
          ),
          external('features/example/server/src/index.ts', "import '@evespace/esi-client'"),
        ],
        'installed-module',
      ),
    ).toEqual([
      'features/example/server/src/index.ts: installed module cannot import core ESI execution or SDK runtime code',
      'features/example/server/src/index.ts: installed module cannot import core ESI execution or SDK runtime code',
    ])
  })
})

function source(module: string, contents: string) {
  return { path: `api/src/esi-gateway/${module}.ts`, source: contents }
}

function external(path: string, contents: string) {
  return { path, source: contents }
}

function last(value: string) {
  return value.split('/').at(-1)!
}
