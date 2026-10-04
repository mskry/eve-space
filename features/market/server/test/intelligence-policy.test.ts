import { describe, expect, test } from 'vitest'
import {
  buildMarketIntelligenceUniverse,
  defaultMarketIntelligencePolicy,
  validateMarketIntelligencePolicy,
} from '../src/intelligence-policy.js'

const revision = { buildNumber: 3552227, ingestVersion: 6, ingestedAt: '2026-10-04T00:00:00Z' }
const group = (id: number, parentId: number | null = null) => ({
  id,
  parentId,
  name: String(id),
  iconId: null,
  directTypeCount: 0,
})
const tree = {
  kind: 'tree' as const,
  complete: true as const,
  revision,
  groups: [group(1), group(614), group(751, 614), group(2, 751), group(3, 1)],
}
const index = {
  kind: 'search-index' as const,
  complete: true as const,
  revision,
  types: [
    { id: 34, groupId: 1, name: 'Tritanium' },
    { id: 35, groupId: 3, name: 'No visible orders' },
    { id: 36, groupId: 2, name: 'Excluded descendant' },
    { id: 37, groupId: 751, name: 'Excluded direct child' },
    { id: 44992, groupId: 1, name: 'PLEX' },
  ],
}
const policy = { enabled: true, ignoredGroupIds: [614, 751] }
const profile = { enabled: true, mode: 'region' as const, regionId: 10000002, watchedTypeIds: [] }

describe('Market intelligence universe', () => {
  test('starts disabled with the specified administrator preset', () => {
    expect(defaultMarketIntelligencePolicy()).toEqual({
      enabled: false,
      ignoredGroupIds: [
        150, 1954, 3630, 204, 209, 1041, 1338, 2157, 2158, 1663, 20, 22, 23, 2801, 1846, 492, 614,
        751, 754, 1109, 2480, 1396,
      ],
    })
    const changed = defaultMarketIntelligencePolicy()
    expect(changed).not.toBe(defaultMarketIntelligencePolicy())
  })

  test('deduplicates nested exclusions and admits eligible types independently of orders', () => {
    const universe = buildMarketIntelligenceUniverse(tree, index, policy, profile)
    expect(universe.targets).toEqual([
      { typeId: 34, groupId: 1, name: 'Tritanium', groupIds: [1] },
      { typeId: 35, groupId: 3, name: 'No visible orders', groupIds: [3, 1] },
    ])
    expect(universe.excludedGroupIds).toEqual([2, 614, 751])
    expect(universe.excludedTypeCount).toBe(2)
    expect(
      buildMarketIntelligenceUniverse(tree, index, policy, {
        ...profile,
        mode: 'watched-types',
        regionId: 19000001,
        watchedTypeIds: [44992],
      }).targets,
    ).toEqual([{ typeId: 44992, groupId: 1, name: 'PLEX', groupIds: [1] }])
    expect(index.types).toHaveLength(5)
  })

  test('returns watched targets and exclusions together without counting unwatched types', () => {
    const universe = buildMarketIntelligenceUniverse(tree, index, policy, {
      ...profile,
      mode: 'watched-types',
      watchedTypeIds: [34, 36, 999, 44992],
    })
    expect(universe.targets.map(({ typeId }) => typeId)).toEqual([34])
    expect(universe.excludedTargets.map(({ typeId }) => typeId)).toEqual([36])
    expect(universe.ignoredTypeIds).toEqual([36])
    expect(universe.excludedTypeCount).toBe(1)
    expect(universe.excludedGroupIds).toEqual([2, 614, 751])
  })

  test.each([[614, 614], [999], [0], [-1], [NaN]])(
    'rejects invalid ignored groups %j',
    (...ignoredGroupIds) => {
      expect(() =>
        validateMarketIntelligencePolicy({ enabled: true, ignoredGroupIds }, profile, tree),
      ).toThrow(Error)
    },
  )

  test('requires an enabled full-region profile for broad opt-in', () => {
    for (const invalid of [
      { ...profile, enabled: false },
      { ...profile, mode: 'watched-types' as const },
      { ...profile, regionId: 19000001 },
    ]) {
      expect(() => validateMarketIntelligencePolicy(policy, invalid, tree)).toThrow('full-region')
      expect(
        validateMarketIntelligencePolicy({ ...policy, enabled: false }, invalid, tree).enabled,
      ).toBe(false)
    }
  })

  test('rejects unmatched, incomplete, malformed, and oversized catalogue replacements', () => {
    expect(() =>
      buildMarketIntelligenceUniverse(
        tree,
        { ...index, revision: { ...revision, ingestVersion: 7 } },
        policy,
        profile,
      ),
    ).toThrow('revisions')
    expect(() =>
      buildMarketIntelligenceUniverse(
        tree,
        // SAFETY: Deliberately bypass the complete catalogue contract to exercise runtime rejection.
        { ...index, complete: false as never },
        policy,
        profile,
      ),
    ).toThrow('complete')
    expect(() =>
      buildMarketIntelligenceUniverse(
        { ...tree, groups: [group(1, 3), group(3, 1)] },
        index,
        { enabled: true, ignoredGroupIds: [] },
        profile,
      ),
    ).toThrow('cyclic')
    expect(() =>
      buildMarketIntelligenceUniverse(
        { ...tree, groups: [group(1, 999)] },
        index,
        { enabled: true, ignoredGroupIds: [] },
        profile,
      ),
    ).toThrow('incomplete')
    expect(() =>
      buildMarketIntelligenceUniverse(
        tree,
        { ...index, types: [...index.types, index.types[0]!] },
        policy,
        profile,
      ),
    ).toThrow('duplicate types')
    const types = Array.from({ length: 32_000 }, (_, position) => ({
      id: position + 1,
      groupId: 1,
      name: `Item ${position}`,
    }))
    expect(
      buildMarketIntelligenceUniverse(tree, { ...index, types }, policy, profile).targets,
    ).toHaveLength(32_000)
    expect(() =>
      buildMarketIntelligenceUniverse(
        tree,
        { ...index, types: [...types, { id: 32001, groupId: 1, name: 'Overflow' }] },
        policy,
        profile,
      ),
    ).toThrow('bounded')
    expect(() =>
      buildMarketIntelligenceUniverse(
        { ...tree, groups: Array.from({ length: 4001 }, (_, position) => group(position + 1)) },
        index,
        policy,
        profile,
      ),
    ).toThrow('bounded')
    expect(() =>
      validateMarketIntelligencePolicy(
        {
          enabled: true,
          ignoredGroupIds: Array.from({ length: 257 }, (_, position) => position + 1),
        },
        profile,
        tree,
      ),
    ).toThrow('bound')
  })
})
