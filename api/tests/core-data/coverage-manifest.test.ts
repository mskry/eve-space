import { readFile } from 'node:fs/promises'
import { describe, expect, test } from 'vitest'
import { coreDataCoverageManifest } from '../../src/core-data/coverage-manifest.js'
import { renderCoreDataCoverageReport } from '../../src/core-data/coverage-report.js'
import { assertCoreDataCoverageManifest } from '../../src/core-data/coverage-validation.js'
import { coreEsiOperationIds } from '../../src/esi-gateway/catalog-interface.js'

const authorities = { esiOperationIds: coreEsiOperationIds }

describe('core-data coverage manifest', () => {
  test('validates canonical ownership and exact runtime bindings', () => {
    expect(() => assertCoreDataCoverageManifest(authorities)).not.toThrow()
  })

  test.each([
    [() => replacePublishedProduct({ owner: '' }), ['published-type-groups is missing an owner']],
    [() => [...cloneManifest(), { ...cloneManifest()[0] }], ['has duplicate ownership entries']],
    [() => replacePublishedProduct({ exposure: 'external' }), ['has invalid exposure']],
    [
      () => replacePublishedProduct({ productId: { value: 'published-type-groups' } }),
      ['has invalid product identifier'],
    ],
    [
      () => replacePublishedProduct({ productId: undefined }),
      ['is missing its module-product binding', 'must have exactly one coverage entry'],
    ],
    [
      () => replacePublishedProduct({ status: 'deferred' }),
      ['binds a product without implemented module-product exposure'],
    ],
    [
      () => replacePublishedProduct({ esiOperationIds: ['removed-operation'] }),
      ['references stale ESI operation'],
    ],
  ])('rejects invalid ownership fixtures', (createManifest, messages) => {
    expect(() => assertCoreDataCoverageManifest(authorities, createManifest())).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(messages.map(escapeRegex).join('|')),
      }),
    )
  })

  test('rejects missing, duplicate, and unknown executable bindings', () => {
    expect(() => assertCoreDataCoverageManifest(authorities, cloneManifest(), [])).toThrow(
      'must have exactly one executable adapter',
    )
    expect(() =>
      assertCoreDataCoverageManifest(authorities, cloneManifest(), [
        'published-type-groups',
        'published-type-groups',
      ]),
    ).toThrow('must have exactly one executable adapter')
    expect(() =>
      assertCoreDataCoverageManifest(authorities, cloneManifest(), [
        'published-type-groups',
        'unknown-product',
      ]),
    ).toThrow('unknown executable product')
  })

  test('generates the checked-in report deterministically', async () => {
    const expected = renderCoreDataCoverageReport(coreDataCoverageManifest)
    const reversed = renderCoreDataCoverageReport(coreDataCoverageManifest.toReversed())
    const checkedIn = await readFile(
      new URL('../../../docs/core-eve-data-coverage.md', import.meta.url),
      'utf8',
    )

    expect(reversed).toBe(expected)
    expect(checkedIn).toBe(expected)
  })
})

function cloneManifest(): Record<string, unknown>[] {
  const manifest: Record<string, unknown>[] = []
  for (const entry of coreDataCoverageManifest) {
    const clonedEntry = { ...entry }
    if (entry.esiOperationIds) {
      clonedEntry.esiOperationIds = [...entry.esiOperationIds]
    }
    manifest.push(clonedEntry)
  }
  return manifest
}

function replacePublishedProduct(overrides: Record<string, unknown>) {
  const manifest = cloneManifest()
  const entry = manifest.find(({ productId }) => productId === 'published-type-groups')
  if (entry) {
    Object.assign(entry, overrides)
  }
  return manifest
}

function escapeRegex(value: string) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
