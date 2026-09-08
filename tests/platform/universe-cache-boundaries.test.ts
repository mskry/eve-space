import { describe, expect, test } from 'vitest'
import {
  type UniverseCacheSource,
  universeCacheImportViolations,
} from '../../scripts/universe-cache/boundaries'

describe('universe cache dependency boundaries', () => {
  test.each([
    ['static-location-cache-state', 'static-location-types'],
    ['static-location-store', 'static-location-types'],
    ['static-locations', 'static-location-types'],
    ['static-locations', 'static-location-cache-state'],
    ['static-locations', 'static-location-store'],
  ])('allows %s to import %s', (sourceModule, importedModule) => {
    expect(
      universeCacheImportViolations([source(sourceModule, `import './${importedModule}.js'`)]),
    ).toEqual([])
  })

  test.each([
    ['static-location-types', 'static-location-cache-state'],
    ['static-location-types', 'static-location-store'],
    ['static-location-types', 'static-locations'],
    ['static-location-cache-state', 'static-location-store'],
    ['static-location-cache-state', 'static-locations'],
    ['static-location-store', 'static-location-cache-state'],
    ['static-location-store', 'static-locations'],
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
})

function source(module: string, content: string): UniverseCacheSource {
  return { path: `api/src/universe/${module}.ts`, source: content }
}
