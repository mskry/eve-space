import { describe, expect, it } from 'vitest'
import { coreDataBoundaryViolations } from '../../scripts/core-data/boundaries'
import { loadCoreDataBoundarySources } from '../../scripts/core-data/sources'

describe('core-data boundaries', () => {
  it('accepts the repository dependency graph', async () => {
    const sources = await loadCoreDataBoundarySources(process.cwd())

    expect(coreDataBoundaryViolations(sources)).toEqual([])
  }, 15_000)

  it('keeps the contract package dependency-free', () => {
    expect(
      coreDataBoundaryViolations([
        source('packages/core-data-contract/src/index.ts', "import type { Sql } from 'postgres'"),
      ]),
    ).toEqual([
      'packages/core-data-contract/src/index.ts: pure core-data contract cannot import postgres',
    ])
  })

  it('rejects computed dynamic imports before they can bypass dependency checks', () => {
    expect(
      coreDataBoundaryViolations([
        source(
          'packages/core-data-contract/src/index.ts',
          "const dependency = 'postgres'\nexport const load = () => import(dependency)",
        ),
        source(
          'api/src/core-data/published-type-groups-adapter.ts',
          "const source = '../characters/service.js'\nexport const load = () => import(source)",
        ),
        source(
          'api/src/characters/service.ts',
          "const source = '../core-data/capabilities.js'\nexport const load = () => import(source)",
        ),
      ]),
    ).toEqual([
      'api/src/characters/service.ts: core-data dynamic imports must use string literals',
      'api/src/core-data/published-type-groups-adapter.ts: core-data dynamic imports must use string literals',
      'packages/core-data-contract/src/index.ts: core-data dynamic imports must use string literals',
    ])
  })

  it('validates literal template dynamic imports through the normal dependency rules', () => {
    expect(
      coreDataBoundaryViolations([
        source(
          'api/src/core-data/product-catalog.ts',
          'export const load = () => import(`./capabilities.js`)',
        ),
      ]),
    ).toEqual([
      'api/src/core-data/product-catalog.ts: catalog module product-catalog cannot import capability module capabilities',
    ])
  })

  it('enforces implementation tiers and canonical adapter sources', () => {
    expect(
      coreDataBoundaryViolations([
        source(
          'api/src/core-data/product-catalog.ts',
          "import './capabilities.js'\nimport '../platform/routes.js'",
        ),
      ]),
    ).toEqual([
      'api/src/core-data/product-catalog.ts: catalog module product-catalog cannot import capability module capabilities',
      'api/src/core-data/product-catalog.ts: catalog module product-catalog cannot import source implementation ../platform/routes.js',
    ])
  })

  it('requires every implementation module to have a declared tier', () => {
    expect(coreDataBoundaryViolations([source('api/src/core-data/new-product.ts', '')])).toEqual([
      'api/src/core-data/new-product.ts: core-data module new-product has no declared tier',
    ])
  })

  it('prevents domain callers from traversing the product subsystem', () => {
    expect(
      coreDataBoundaryViolations([
        source(
          'api/src/characters/service.ts',
          "import { createCoreDataCapability } from '../core-data/capabilities.js'",
        ),
      ]),
    ).toEqual([
      'api/src/characters/service.ts: only approved startup and platform capability integration may import core-data module capabilities',
    ])
  })

  it('allows only the reviewed startup and platform integrations', () => {
    expect(
      coreDataBoundaryViolations([
        source(
          'api/src/server.ts',
          "import './core-data/product-catalog.js'\nimport './core-data/coverage-validation.js'",
        ),
        source(
          'api/src/platform/module-route-capabilities.ts',
          "import '../core-data/capabilities.js'",
        ),
      ]),
    ).toEqual([])
  })

  it('rejects generic product dispatchers and method maps', () => {
    expect(
      coreDataBoundaryViolations([
        source(
          'packages/core-data-contract/src/index.ts',
          'export interface CoreDataMethods { [product: string]: unknown }\nexport function executeCoreDataProduct() {}',
        ),
      ]),
    ).toEqual([
      'packages/core-data-contract/src/index.ts: core-data must not expose generic dispatcher executeCoreDataProduct',
      'packages/core-data-contract/src/index.ts: CoreDataMethods must declare exact product methods',
    ])
  })

  it('rejects dependency cycles', () => {
    expect(
      coreDataBoundaryViolations([
        source('api/src/core-data/product-catalog.ts', "import './capabilities.js'"),
        source('api/src/core-data/capabilities.ts', "import './product-catalog.js'"),
      ]),
    ).toContain('Core-data dependency cycle: capabilities -> product-catalog -> capabilities')
  })
})

function source(path: string, contents: string) {
  return { path, source: contents }
}
