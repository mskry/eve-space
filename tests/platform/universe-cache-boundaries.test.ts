import { describe, expect, test } from 'vitest'
import {
  type UniverseCacheSource,
  universeCacheImportViolations,
} from '../../scripts/universe-cache/boundaries'

describe('universe cache dependency boundaries', () => {
  test.each([
    ['static-location-types', 'sde-revision'],
    ['route-types', 'sde-revision'],
    ['static-locations', 'sde-revision'],
    ['topology', 'sde-revision'],
    ['static-location-cache-state', 'static-location-types'],
    ['static-location-store', 'database-read'],
    ['static-location-store', 'static-location-types'],
    ['static-locations', 'static-location-types'],
    ['static-locations', 'static-location-cache-state'],
    ['static-locations', 'static-location-store'],
    ['topology-state', 'route-types'],
    ['topology-store', 'database-read'],
    ['topology-store', 'route-types'],
    ['topology', 'route-types'],
    ['topology', 'topology-state'],
    ['topology', 'topology-store'],
    ['route-calculator', 'route-types'],
    ['route-calculator', 'topology'],
  ])('allows %s to import %s', (sourceModule, importedModule) => {
    expect(
      universeCacheImportViolations([source(sourceModule, `import './${importedModule}.js'`)]),
    ).toEqual([])
  })

  test.each([
    ['sde-revision', 'static-location-types'],
    ['sde-revision', 'route-types'],
    ['static-location-types', 'static-location-cache-state'],
    ['database-read', 'static-location-types'],
    ['static-location-types', 'static-location-store'],
    ['static-location-types', 'static-locations'],
    ['static-location-cache-state', 'static-location-store'],
    ['static-location-cache-state', 'static-locations'],
    ['static-location-store', 'static-location-cache-state'],
    ['static-location-store', 'static-locations'],
    ['route-types', 'topology-state'],
    ['route-types', 'topology-store'],
    ['route-types', 'topology'],
    ['route-types', 'route-calculator'],
    ['topology-state', 'topology-store'],
    ['topology-state', 'topology'],
    ['topology-state', 'route-calculator'],
    ['topology-store', 'topology-state'],
    ['topology-store', 'topology'],
    ['topology-store', 'route-calculator'],
    ['topology', 'route-calculator'],
    ['database-read', 'topology-store'],
  ])('rejects %s importing %s', (sourceModule, importedModule) => {
    expect(
      universeCacheImportViolations([source(sourceModule, `import './${importedModule}.js'`)]),
    ).toEqual([expect.stringContaining(`${sourceModule} cannot import`)])
  })

  test('rejects undeclared static-location modules', () => {
    expect(universeCacheImportViolations([source('static-location-extra', '')])).toEqual([
      'api/src/universe/static-location-extra.ts: universe cache module static-location-extra has no declared tier',
    ])
  })

  test('rejects imports of undeclared local universe modules', () => {
    expect(
      universeCacheImportViolations([source('database-read', "import './database-extra.js'")]),
    ).toEqual([
      'api/src/universe/database-read.ts: database module database-read imports undeclared universe module database-extra',
    ])
  })
})

function source(module: string, content: string): UniverseCacheSource {
  return { path: `api/src/universe/${module}.ts`, source: content }
}
