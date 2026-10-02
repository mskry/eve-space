import type { MarketType } from './market-catalogue-types'
import {
  addMarketQuickbarItem,
  createMarketQuickbarFolder,
  emptyMarketQuickbar,
  marketQuickbarChildKeys,
  maxMarketQuickbarFolders,
  maxMarketQuickbarItems,
  rootQuickbarFolderId,
  type MarketQuickbarState,
} from './market-quickbar'

const validLineName = (name: string): boolean =>
  Boolean(name.trim()) && !name.includes('\n') && !name.includes('\r')

const exportTypeLine = (name: string | undefined, depth: number): string | null => {
  if (!name || !validLineName(name)) return null
  if (depth === 0 && (name.startsWith('+') || name.startsWith('-'))) return null
  const prefix = depth ? `${'-'.repeat(depth)} ` : ''
  return `${prefix}${name}`
}

export const exportMarketQuickbarText = (
  state: MarketQuickbarState,
  types: readonly MarketType[],
): string | null => {
  const names = new Map(types.map((type) => [type.id, type.name]))
  const lines: string[] = []
  const writeNode = (key: string, depth: number): boolean => {
    if (key.startsWith('folder:')) {
      const folder = state[key.slice(7)]
      if (!folder || !validLineName(folder.name)) return false
      lines.push(`${'+'.repeat(depth + 1)} ${folder.name}`)
      return marketQuickbarChildKeys(folder).every((child) => writeNode(child, depth + 1))
    }
    const line = exportTypeLine(names.get(Number(key.slice(5))), depth)
    if (line === null) return false
    lines.push(line)
    return true
  }

  const complete = marketQuickbarChildKeys(state[rootQuickbarFolderId]).every((key) =>
    writeNode(key, 0),
  )
  return complete ? lines.join('\n') : null
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
  updated[parentId]!.order = [...marketQuickbarChildKeys(state[parentId]!), `folder:${id}`]
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
  if (updated !== state)
    updated[parentId]!.order = [...marketQuickbarChildKeys(state[parentId]!), `item:${typeId}`]
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
