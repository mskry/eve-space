import { expect, test } from 'vitest'
import { marketTypeImageVariation } from '../src/runtime/app/useMarketTypeImage'

const groups = [
  { id: 2, parentId: null, name: 'Blueprints & Reactions', iconId: null, directTypeCount: 0 },
  { id: 211, parentId: 2, name: 'Charges', iconId: null, directTypeCount: 0 },
  { id: 1016, parentId: 211, name: 'Bombs', iconId: null, directTypeCount: 1 },
  { id: 19, parentId: null, name: 'Trade Goods', iconId: null, directTypeCount: 1 },
  { id: 3835, parentId: null, name: 'Special Edition', iconId: null, directTypeCount: 1 },
]

test('uses bp images for blueprints and reaction formulas, including outlying market groups', () => {
  expect(
    marketTypeImageVariation(
      { id: 27913, groupId: 1016, name: 'Concussion Bomb Blueprint' },
      groups,
    ),
  ).toBe('bp')
  expect(
    marketTypeImageVariation(
      { id: 46157, groupId: 1016, name: 'Methanofullerene Reaction Formula' },
      groups,
    ),
  ).toBe('bp')
  expect(
    marketTypeImageVariation(
      { id: 33067, groupId: 3835, name: 'Deactivated Station Key Pass Blueprint' },
      groups,
    ),
  ).toBe('bp')
  expect(marketTypeImageVariation({ id: 34, groupId: 19, name: 'Tritanium' }, groups)).toBe('icon')
})
