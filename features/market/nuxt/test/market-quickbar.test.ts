import { expect, test } from 'vitest'
import {
  addMarketQuickbarItem,
  createMarketQuickbarFolder,
  decodeMarketQuickbar,
  emptyMarketQuickbar,
  marketQuickbarTypeIds,
  marketQuickbarChildKeys,
  maxMarketQuickbarItems,
  mergeMarketQuickbars,
  moveMarketQuickbarFolder,
  moveMarketQuickbarItem,
  parseMarketQuickbarIds,
  removeMarketQuickbarFolder,
  removeMarketQuickbarItem,
  renameMarketQuickbarFolder,
  restoreMarketQuickbar,
  rootQuickbarFolderId,
} from '../src/runtime/app/market-quickbar'
import {
  exportMarketQuickbarText,
  importMarketQuickbarText,
} from '../src/runtime/app/market-quickbar-transfer'
import { sortMarketQuickbar } from '../src/runtime/app/market-quickbar-sort'
import {
  buildMarketQuickbarTree,
  marketQuickbarNodeKey,
} from '../src/runtime/app/market-quickbar-tree'

test('restores only bounded, distinct, positive type IDs from browser storage', () => {
  expect(parseMarketQuickbarIds(null)).toEqual([])
  expect(parseMarketQuickbarIds('{bad json')).toEqual([])
  expect(parseMarketQuickbarIds('{"id":587}')).toEqual([])
  expect(parseMarketQuickbarIds(JSON.stringify([587, 587, 0, -1, '34', 34.5, 34]))).toEqual([
    587, 34,
  ])
  expect(
    parseMarketQuickbarIds(
      JSON.stringify(Array.from({ length: maxMarketQuickbarItems + 10 }, (_, index) => index + 1)),
    ),
  ).toHaveLength(maxMarketQuickbarItems)
})

test('restores the earlier flat pins and rejects invalid folder graphs', () => {
  expect(restoreMarketQuickbar('[587,34,587]')[rootQuickbarFolderId].types).toEqual([587, 34])
  expect(restoreMarketQuickbar('{bad json')).toEqual(emptyMarketQuickbar())
  expect(
    decodeMarketQuickbar({
      __root__: { name: '__root__', types: [], childFolders: ['a'] },
      a: { name: 'A', types: [587], childFolders: ['a'] },
    }),
  ).toBeNull()
  expect(
    decodeMarketQuickbar({
      __root__: { name: '__root__', types: [587], childFolders: ['a'] },
      a: { name: 'A', types: [587], childFolders: [] },
    }),
  ).toBeNull()
  expect(
    decodeMarketQuickbar({
      __root__: { name: '__root__', types: [], childFolders: [] },
      orphan: { name: 'Orphan', types: [], childFolders: [] },
    }),
  ).toBeNull()
})

test('moves saved items and folders without duplication or mutating prior state', () => {
  const empty = emptyMarketQuickbar()
  const rootItem = addMarketQuickbarItem(empty, 587)
  const folder = createMarketQuickbarFolder(rootItem, 'ships', 'Ships')
  const nested = createMarketQuickbarFolder(folder, 'frigates', 'Frigates', 'ships')
  const movedItem = moveMarketQuickbarItem(nested, 587, 'frigates')
  expect(marketQuickbarTypeIds(movedItem)).toEqual([587])
  expect(rootItem[rootQuickbarFolderId].types).toEqual([587])
  const renamed = renameMarketQuickbarFolder(movedItem, 'frigates', 'Small ships')
  expect(renamed.frigates?.name).toBe('Small ships')
  expect(moveMarketQuickbarFolder(renamed, 'ships', 'frigates')).toBe(renamed)
  const flattened = removeMarketQuickbarFolder(renamed, 'ships')
  expect(flattened[rootQuickbarFolderId].childFolders).toEqual(['frigates'])
  expect(flattened.frigates?.types).toEqual([587])
  expect(removeMarketQuickbarItem(flattened, 587).frigates?.types).toEqual([])
})

test('imports and exports EVE Quickbar text with nested folders and merges distinct IDs', () => {
  const types = [
    { id: 587, groupId: 1, name: 'Rifter' },
    { id: 44992, groupId: 2, name: 'PLEX' },
    { id: 34, groupId: 3, name: 'Tritanium' },
  ]
  const text = '+ Ships\n++ Frigates\n-- Rifter\n- PLEX\nTritanium'
  let id = 0
  const imported = importMarketQuickbarText(text, types, () => `folder-${++id}`)
  expect(imported).not.toBeNull()
  if (!imported) return
  expect(exportMarketQuickbarText(imported, types)).toBe(text)
  expect(marketQuickbarTypeIds(imported).toSorted((left, right) => left - right)).toEqual([
    34, 587, 44992,
  ])
  const existing = addMarketQuickbarItem(emptyMarketQuickbar(), 587)
  const merged = mergeMarketQuickbars(existing, imported)
  expect(marketQuickbarTypeIds(merged).toSorted((left, right) => left - right)).toEqual([
    34, 587, 44992,
  ])
  expect(importMarketQuickbarText('+ Ships\n--- Rifter', types, () => 'bad')).toBeNull()
  expect(importMarketQuickbarText('Unknown item', types, () => 'bad')).toBeNull()
})

test('persists mixed sibling order through catalogue changes, removal and text transfer', () => {
  const types = [
    { id: 587, groupId: 1, name: 'Rifter' },
    { id: 34, groupId: 3, name: 'Tritanium' },
  ]
  let state = createMarketQuickbarFolder(emptyMarketQuickbar(), 'ships', 'Ships')
  state = addMarketQuickbarItem(addMarketQuickbarItem(state, 34), 587)
  const sorted = sortMarketQuickbar(state, 'item:34', null, 'folder:ships')
  expect(marketQuickbarChildKeys(sorted[rootQuickbarFolderId])).toEqual([
    'item:34',
    'folder:ships',
    'item:587',
  ])
  expect(state[rootQuickbarFolderId].types).toEqual([587, 34])
  const restored = restoreMarketQuickbar(JSON.stringify(sorted))
  expect(
    buildMarketQuickbarTree(restored, new Map(types.map((type) => [type.id, type]))).map(
      marketQuickbarNodeKey,
    ),
  ).toEqual(['item:34', 'folder:ships', 'item:587'])
  expect(
    buildMarketQuickbarTree(restored, new Map([[587, types[0]!]])).map(marketQuickbarNodeKey),
  ).toEqual(['folder:ships', 'item:587'])
  const text = exportMarketQuickbarText(restored, types)
  expect(text).toBe('Tritanium\n+ Ships\nRifter')
  const imported = importMarketQuickbarText(text!, types, () => 'ships')!
  expect(exportMarketQuickbarText(imported, types)).toBe(text)
  expect(
    restoreMarketQuickbar(JSON.stringify(removeMarketQuickbarItem(restored, 34)))[
      rootQuickbarFolderId
    ].order,
  ).toEqual(['folder:ships', 'item:587'])
  expect(
    decodeMarketQuickbar({
      ...restored,
      __root__: {
        ...restored[rootQuickbarFolderId],
        order: ['item:34', 'item:34', 'folder:ships'],
      },
    }),
  ).toBeNull()
})

test.each([
  {
    parentOrder: 'fallback',
    expected: [
      'folder:before',
      'item:587',
      'folder:frigates',
      'item:34',
      'folder:after',
      'item:44992',
    ],
  },
  {
    parentOrder: 'mixed',
    expected: [
      'folder:before',
      'item:44992',
      'item:587',
      'folder:frigates',
      'item:34',
      'folder:after',
    ],
  },
])(
  'preserves promoted mixed child order at the deleted folder’s position in a $parentOrder parent',
  ({ parentOrder, expected }) => {
    let state = createMarketQuickbarFolder(emptyMarketQuickbar(), 'after', 'After')
    state = createMarketQuickbarFolder(state, 'ships', 'Ships')
    state = createMarketQuickbarFolder(state, 'before', 'Before')
    state = createMarketQuickbarFolder(state, 'frigates', 'Frigates', 'ships')
    state = addMarketQuickbarItem(state, 44992)
    state = addMarketQuickbarItem(addMarketQuickbarItem(state, 34, 'ships'), 587, 'ships')
    state = sortMarketQuickbar(state, 'item:587', 'folder:ships', 'folder:frigates')
    if (parentOrder === 'mixed') {
      state = sortMarketQuickbar(state, 'item:44992', null, 'folder:ships')
    }

    const flattened = removeMarketQuickbarFolder(state, 'ships')

    expect(marketQuickbarChildKeys(flattened[rootQuickbarFolderId])).toEqual(expected)
    expect(
      marketQuickbarChildKeys(
        restoreMarketQuickbar(JSON.stringify(flattened))[rootQuickbarFolderId],
      ),
    ).toEqual(expected)
    expect(flattened.ships).toBeUndefined()
    expect(state[rootQuickbarFolderId].childFolders).toEqual(['before', 'ships', 'after'])
  },
)

test('rejects sorting cycles, missing anchors and excessive depth without changing the saved tree', () => {
  let state = createMarketQuickbarFolder(emptyMarketQuickbar(), 'ships', 'Ships')
  state = createMarketQuickbarFolder(state, 'frigates', 'Frigates', 'ships')
  expect(sortMarketQuickbar(state, 'folder:ships', 'folder:frigates', null)).toBe(state)
  expect(sortMarketQuickbar(state, 'folder:frigates', null, 'item:404')).toBe(state)
  let parent = rootQuickbarFolderId
  for (let depth = 1; depth <= 8; depth += 1) {
    const id = `depth-${depth}`
    state = createMarketQuickbarFolder(state, id, id, parent)
    parent = id
  }
  expect(sortMarketQuickbar(state, 'folder:ships', `folder:${parent}`, null)).toBe(state)
})
