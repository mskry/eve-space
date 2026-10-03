interface MarketQuickbarJsonRecord {
  [key: string]: MarketQuickbarJsonValue
}

type MarketQuickbarJsonValue =
  | string
  | number
  | boolean
  | null
  | MarketQuickbarJsonValue[]
  | MarketQuickbarJsonRecord

export const marketQuickbarStorageKey = 'eve-space-market-quickbar-v1'
export const rootQuickbarFolderId = '__root__'
export const maxMarketQuickbarItems = 100
export const maxMarketQuickbarFolders = 50

type MarketQuickbarFolder = {
  name: string
  types: number[]
  childFolders: string[]
  order?: string[]
}

export interface MarketQuickbarState {
  __root__: MarketQuickbarFolder
  [folderId: string]: MarketQuickbarFolder
}

export interface MarketQuickbarFolderOption {
  id: string
  label: string
}

export interface MarketQuickbarDragData {
  scope: string
  kind: string
  id: string
}

export const emptyMarketQuickbar = (): MarketQuickbarState => ({
  __root__: { name: rootQuickbarFolderId, types: [], childFolders: [] },
})

const isRecord = (value: MarketQuickbarJsonValue): value is MarketQuickbarJsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const validTypeId = (value: MarketQuickbarJsonValue): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

const validFolderName = (name: string): boolean =>
  Boolean(name.trim()) && name.length <= 80 && !name.includes('\n') && !name.includes('\r')

export const marketQuickbarChildKeys = (folder: MarketQuickbarFolder): string[] => {
  const keys = [
    ...folder.childFolders.map((id) => `folder:${id}`),
    ...folder.types.map((id) => `item:${id}`),
  ]
  const remaining = new Set(keys)
  const ordered = (folder.order ?? []).filter((key) => remaining.delete(key))
  return [...ordered, ...keys.filter((key) => remaining.has(key))]
}

const decodeFolderOrder = (
  value: MarketQuickbarJsonValue | undefined,
  folder: MarketQuickbarFolder,
): string[] | null => {
  if (value === undefined) return marketQuickbarChildKeys(folder)
  if (!Array.isArray(value)) return null
  const keys = new Set(marketQuickbarChildKeys(folder))
  if (value.length !== keys.size) return null
  const order: string[] = []
  for (const key of value) {
    if (typeof key !== 'string' || !keys.delete(key)) return null
    order.push(key)
  }
  return order
}

const decodeOrderedFolder = (
  value: MarketQuickbarJsonValue | undefined,
  folder: MarketQuickbarFolder,
): MarketQuickbarFolder | null => {
  const order = decodeFolderOrder(value, folder)
  if (!order) return null
  if (value !== undefined) folder.order = order
  return folder
}

export const parseMarketQuickbarIds = (raw: string | null): number[] => {
  if (raw === null) return []
  let values: MarketQuickbarJsonValue
  try {
    values = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(values)) return []
  const ids: number[] = []
  const seen = new Set<number>()
  for (const value of values) {
    if (!validTypeId(value) || seen.has(value)) continue
    seen.add(value)
    ids.push(value)
    if (ids.length === maxMarketQuickbarItems) break
  }
  return ids
}

const decodeFolder = (value: MarketQuickbarJsonValue): MarketQuickbarFolder | null => {
  if (!isRecord(value) || typeof value.name !== 'string') return null
  if (!validFolderName(value.name)) return null
  if (!Array.isArray(value.types) || !Array.isArray(value.childFolders)) return null
  if (
    value.types.length > maxMarketQuickbarItems ||
    value.childFolders.length > maxMarketQuickbarFolders
  )
    return null
  const types: number[] = []
  for (const id of value.types) {
    if (!validTypeId(id)) return null
    types.push(id)
  }
  const childFolders: string[] = []
  for (const id of value.childFolders) {
    if (typeof id !== 'string' || !id || id.length > 64) return null
    childFolders.push(id)
  }
  return decodeOrderedFolder(value.order, { name: value.name, types, childFolders })
}

const validHierarchy = (state: MarketQuickbarState): boolean => {
  const folders = new Set<string>()
  const types = new Set<number>()
  const visit = (id: string, depth: number): boolean => {
    if (depth > 8 || folders.has(id)) return false
    const folder = state[id]
    if (!folder) return false
    folders.add(id)
    for (const typeId of folder.types) {
      if (types.has(typeId)) return false
      types.add(typeId)
    }
    return folder.childFolders.every((childId) => visit(childId, depth + 1))
  }
  return (
    visit(rootQuickbarFolderId, 0) &&
    folders.size === Object.keys(state).length &&
    folders.size <= maxMarketQuickbarFolders + 1 &&
    types.size <= maxMarketQuickbarItems
  )
}

export const decodeMarketQuickbar = (
  value: MarketQuickbarJsonValue,
): MarketQuickbarState | null => {
  if (!isRecord(value) || !Object.hasOwn(value, rootQuickbarFolderId)) return null
  const entries = Object.entries(value)
  if (entries.length > maxMarketQuickbarFolders + 1) return null
  const state = emptyMarketQuickbar()
  for (const [id, rawFolder] of entries) {
    if (!id || id.length > 64 || ['__proto__', 'prototype', 'constructor'].includes(id)) return null
    const folder = decodeFolder(rawFolder)
    if (!folder) return null
    state[id] = folder
  }
  if (state[rootQuickbarFolderId].name !== rootQuickbarFolderId) return null
  return validHierarchy(state) ? state : null
}

export const restoreMarketQuickbar = (raw: string | null): MarketQuickbarState => {
  if (raw === null || raw.length > 20_000) return emptyMarketQuickbar()
  let value: MarketQuickbarJsonValue
  try {
    value = JSON.parse(raw)
  } catch {
    return emptyMarketQuickbar()
  }
  if (Array.isArray(value)) {
    const state = emptyMarketQuickbar()
    state[rootQuickbarFolderId].types = parseMarketQuickbarIds(raw)
    return state
  }
  return decodeMarketQuickbar(value) ?? emptyMarketQuickbar()
}

export const copyMarketQuickbar = (state: MarketQuickbarState): MarketQuickbarState => {
  const copy = emptyMarketQuickbar()
  for (const [id, folder] of Object.entries(state)) {
    const copied: MarketQuickbarFolder = {
      name: folder.name,
      types: [...folder.types],
      childFolders: [...folder.childFolders],
    }
    if (folder.order) copied.order = marketQuickbarChildKeys(folder)
    copy[id] = copied
  }
  return copy
}

const reconcileMarketQuickbarOrder = (state: MarketQuickbarState): MarketQuickbarState => {
  for (const folder of Object.values(state)) {
    if (folder.order) folder.order = marketQuickbarChildKeys(folder)
  }
  return state
}

export const marketQuickbarTypeIds = (state: MarketQuickbarState): number[] =>
  Object.values(state).flatMap((folder) => folder.types)

const compareMarketQuickbarFolders = (
  state: MarketQuickbarState,
  left: string,
  right: string,
): number => (state[left]?.name ?? '').localeCompare(state[right]?.name ?? '', 'en')

export const marketQuickbarFolderOptions = (
  state: MarketQuickbarState,
): MarketQuickbarFolderOption[] => {
  const options: MarketQuickbarFolderOption[] = [
    { id: rootQuickbarFolderId, label: 'Quickbar root' },
  ]
  const visit = (id: string, prefix: string) => {
    const children = (state[id]?.childFolders ?? []).toSorted((left, right) =>
      compareMarketQuickbarFolders(state, left, right),
    )
    for (const childId of children) {
      const name = state[childId]?.name
      if (!name) continue
      const label = prefix ? `${prefix} / ${name}` : name
      options.push({ id: childId, label })
      visit(childId, label)
    }
  }
  visit(rootQuickbarFolderId, '')
  return options
}

const parentFolderId = (
  state: MarketQuickbarState,
  id: string | number,
  field: 'types' | 'childFolders',
): string | null =>
  Object.keys(state).find((folderId) => {
    const folder = state[folderId]
    if (field === 'types') return folder?.types.some((typeId) => typeId === id)
    return folder?.childFolders.some((childId) => childId === id)
  }) ?? null

export const marketQuickbarFolderParent = (state: MarketQuickbarState, id: string): string | null =>
  parentFolderId(state, id, 'childFolders')

export const addMarketQuickbarItem = (
  state: MarketQuickbarState,
  typeId: number,
  destinationId = rootQuickbarFolderId,
): MarketQuickbarState => {
  if (!Number.isSafeInteger(typeId) || typeId <= 0 || !state[destinationId]) return state
  if (marketQuickbarTypeIds(state).length >= maxMarketQuickbarItems) return state
  if (parentFolderId(state, typeId, 'types')) return state
  const next = copyMarketQuickbar(state)
  next[destinationId]?.types.unshift(typeId)
  return reconcileMarketQuickbarOrder(next)
}

export const removeMarketQuickbarItem = (
  state: MarketQuickbarState,
  typeId: number,
): MarketQuickbarState => {
  const parentId = parentFolderId(state, typeId, 'types')
  if (!parentId) return state
  const next = copyMarketQuickbar(state)
  const parent = next[parentId]
  if (parent) parent.types = parent.types.filter((id) => id !== typeId)
  return reconcileMarketQuickbarOrder(next)
}

export const moveMarketQuickbarItem = (
  state: MarketQuickbarState,
  typeId: number,
  destinationId: string,
): MarketQuickbarState => {
  const sourceId = parentFolderId(state, typeId, 'types')
  if (!sourceId || !state[destinationId] || sourceId === destinationId) return state
  const next = copyMarketQuickbar(state)
  const source = next[sourceId]
  const destination = next[destinationId]
  if (!source || !destination) return state
  source.types = source.types.filter((id) => id !== typeId)
  destination.types.unshift(typeId)
  return reconcileMarketQuickbarOrder(next)
}

export const createMarketQuickbarFolder = (
  state: MarketQuickbarState,
  id: string,
  name: string,
  destinationId = rootQuickbarFolderId,
): MarketQuickbarState => {
  const label = name.trim()
  if (!id || id.length > 64 || ['__proto__', 'prototype', 'constructor'].includes(id)) return state
  if (!validFolderName(label) || state[id] || !state[destinationId]) return state
  if (Object.keys(state).length > maxMarketQuickbarFolders) return state
  const next = copyMarketQuickbar(state)
  next[id] = { name: label, types: [], childFolders: [] }
  next[destinationId]?.childFolders.unshift(id)
  return validHierarchy(next) ? reconcileMarketQuickbarOrder(next) : state
}

export const renameMarketQuickbarFolder = (
  state: MarketQuickbarState,
  id: string,
  name: string,
): MarketQuickbarState => {
  const label = name.trim()
  if (id === rootQuickbarFolderId || !state[id] || !validFolderName(label)) return state
  const next = copyMarketQuickbar(state)
  if (next[id]) next[id].name = label
  return next
}

export const removeMarketQuickbarFolder = (
  state: MarketQuickbarState,
  id: string,
): MarketQuickbarState => {
  if (id === rootQuickbarFolderId || !state[id]) return state
  const parentId = parentFolderId(state, id, 'childFolders')
  if (!parentId) return state
  const next = copyMarketQuickbar(state)
  const parent = next[parentId]
  const folder = next[id]
  if (!parent || !folder) return state
  parent.order = marketQuickbarChildKeys(parent).flatMap((key) =>
    key === `folder:${id}` ? marketQuickbarChildKeys(folder) : [key],
  )
  parent.childFolders = parent.childFolders.flatMap((childId) =>
    childId === id ? folder.childFolders : [childId],
  )
  parent.types.push(...folder.types)
  delete next[id]
  return reconcileMarketQuickbarOrder(next)
}

const containsFolder = (state: MarketQuickbarState, ancestorId: string, candidateId: string) => {
  const pending = [ancestorId]
  while (pending.length) {
    const id = pending.pop()
    if (id === candidateId) return true
    if (id) pending.push(...(state[id]?.childFolders ?? []))
  }
  return false
}

export const canMoveMarketQuickbarFolder = (
  state: MarketQuickbarState,
  id: string,
  destinationId: string,
): boolean =>
  id !== rootQuickbarFolderId &&
  Boolean(state[id] && state[destinationId]) &&
  !containsFolder(state, id, destinationId)

export const moveMarketQuickbarFolder = (
  state: MarketQuickbarState,
  id: string,
  destinationId: string,
): MarketQuickbarState => {
  if (!canMoveMarketQuickbarFolder(state, id, destinationId)) return state
  const sourceId = parentFolderId(state, id, 'childFolders')
  if (!sourceId || sourceId === destinationId) return state
  const next = copyMarketQuickbar(state)
  const source = next[sourceId]
  const destination = next[destinationId]
  if (!source || !destination) return state
  source.childFolders = source.childFolders.filter((childId) => childId !== id)
  destination.childFolders.unshift(id)
  return validHierarchy(next) ? reconcileMarketQuickbarOrder(next) : state
}

export const mergeMarketQuickbars = (
  current: MarketQuickbarState,
  incoming: MarketQuickbarState,
): MarketQuickbarState => {
  const next = copyMarketQuickbar(current)
  const pinned = new Set(marketQuickbarTypeIds(current))
  for (const [id, folder] of Object.entries(incoming)) {
    if (id === rootQuickbarFolderId) continue
    if (next[id]) return current
    const types = folder.types.filter((typeId) => !pinned.has(typeId))
    types.forEach((typeId) => pinned.add(typeId))
    const merged: MarketQuickbarFolder = {
      name: folder.name,
      types,
      childFolders: [...folder.childFolders],
    }
    if (folder.order) merged.order = [...folder.order]
    next[id] = merged
  }
  next[rootQuickbarFolderId].childFolders.push(...incoming[rootQuickbarFolderId].childFolders)
  for (const typeId of incoming[rootQuickbarFolderId].types) {
    if (pinned.has(typeId)) continue
    next[rootQuickbarFolderId].types.push(typeId)
    pinned.add(typeId)
  }
  next[rootQuickbarFolderId].order = [
    ...marketQuickbarChildKeys(current[rootQuickbarFolderId]),
    ...marketQuickbarChildKeys(incoming[rootQuickbarFolderId]),
  ]
  return validHierarchy(next) ? reconcileMarketQuickbarOrder(next) : current
}
