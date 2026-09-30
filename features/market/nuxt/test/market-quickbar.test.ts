import { expect, test } from 'vitest'
import {
  addMarketQuickbarItem,
  createMarketQuickbarFolder,
  decodeMarketQuickbar,
  emptyMarketQuickbar,
  marketQuickbarTypeIds,
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
