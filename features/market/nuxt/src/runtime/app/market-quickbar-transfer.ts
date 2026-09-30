import type { MarketType } from './market-catalogue-types'
import {
  addMarketQuickbarItem,
  createMarketQuickbarFolder,
  emptyMarketQuickbar,
  maxMarketQuickbarFolders,
  maxMarketQuickbarItems,
  rootQuickbarFolderId,
  type MarketQuickbarState,
} from './market-quickbar'

const validLineName = (name: string): boolean =>
  Boolean(name.trim()) && !name.includes('\n') && !name.includes('\r')

export const exportMarketQuickbarText = (
  state: MarketQuickbarState,
  types: readonly MarketType[],
): string | null => {
  const names = new Map(types.map((type) => [type.id, type.name]))
  const lines: string[] = []
  const writeFolder = (id: string, depth: number): boolean => {
    const folder = state[id]
    if (!folder || !validLineName(folder.name)) return false
    lines.push(`${'+'.repeat(depth)} ${folder.name}`)
    for (const childId of folder.childFolders) {
      if (!writeFolder(childId, depth + 1)) return false
    }
    for (const typeId of folder.types) {
      const name = names.get(typeId)
      if (!name || !validLineName(name)) return false
      lines.push(`${'-'.repeat(depth)} ${name}`)
    }
    return true
  }

  for (const id of state[rootQuickbarFolderId].childFolders) {
    if (!writeFolder(id, 1)) return null
  }
  for (const typeId of state[rootQuickbarFolderId].types) {
    const name = names.get(typeId)
    if (!name || !validLineName(name) || name.startsWith('+') || name.startsWith('-')) return null
    lines.push(name)
  }
  return lines.join('\n')
}

const typeIdsByName = (types: readonly MarketType[]): Map<string, number[]> => {
  const ids = new Map<string, number[]>()
  for (const type of types) ids.set(type.name, [...(ids.get(type.name) ?? []), type.id])
  return ids
}

interface ImportLine {
  kind: 'folder' | 'item'
  depth: number
  name: string
}

const parseImportLine = (line: string): ImportLine | null => {
  const marker = line[0]
  let depth = 0
  if (marker === '+' || marker === '-') {
    while (line[depth] === marker) depth += 1
    if (line[depth] !== ' ' || depth > 8) return null
  }
  const name = depth ? line.slice(depth + 1) : line
  if (!validLineName(name)) return null
  return { kind: marker === '+' ? 'folder' : 'item', depth, name }
}

const appendImportedFolder = (
  state: MarketQuickbarState,
  folderStack: string[],
  line: ImportLine,
  createFolderId: () => string,
): MarketQuickbarState | null => {
  const parentId = folderStack[line.depth - 1]
  if (!parentId) return null
  const id = createFolderId()
  const updated = createMarketQuickbarFolder(state, id, line.name, parentId)
  if (updated === state) return null
  folderStack.length = line.depth
  folderStack.push(id)
  return updated
}

const appendImportedItem = (
  state: MarketQuickbarState,
  folderStack: readonly string[],
  idsByName: ReadonlyMap<string, number[]>,
  line: ImportLine,
): MarketQuickbarState | null => {
  const parentId = line.depth ? folderStack[line.depth] : rootQuickbarFolderId
  const typeIds = idsByName.get(line.name)
  const typeId = typeIds?.[0]
  if (!parentId || typeIds?.length !== 1 || typeId === undefined) return null
  const updated = addMarketQuickbarItem(state, typeId, parentId)
  return updated === state ? null : updated
}

export const importMarketQuickbarText = (
  text: string,
  types: readonly MarketType[],
  createFolderId: () => string,
): MarketQuickbarState | null => {
  if (!text.trim() || text.length > 20_000) return null
  const lines = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
  if (lines.length > maxMarketQuickbarItems + maxMarketQuickbarFolders + 1) return null
  const idsByName = typeIdsByName(types)
  const folderStack = [rootQuickbarFolderId]
  let state = emptyMarketQuickbar()

  for (const line of lines) {
    if (!line) continue
    const parsed = parseImportLine(line)
    if (!parsed) return null
    const updated =
      parsed.kind === 'folder'
        ? appendImportedFolder(state, folderStack, parsed, createFolderId)
        : appendImportedItem(state, folderStack, idsByName, parsed)
    if (!updated) return null
    state = updated
  }
  return state
}
