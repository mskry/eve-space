import { computed, onMounted, ref, type Ref } from 'vue'
import type { MarketType } from './market-catalogue-types'
import {
  addMarketQuickbarItem,
  createMarketQuickbarFolder,
  emptyMarketQuickbar,
  marketQuickbarFolderOptions,
  marketQuickbarStorageKey,
  marketQuickbarTypeIds,
  maxMarketQuickbarFolders,
  maxMarketQuickbarItems,
  mergeMarketQuickbars,
  moveMarketQuickbarFolder,
  moveMarketQuickbarItem,
  removeMarketQuickbarFolder,
  removeMarketQuickbarItem,
  renameMarketQuickbarFolder,
  restoreMarketQuickbar,
  rootQuickbarFolderId,
  type MarketQuickbarDragData,
  type MarketQuickbarState,
} from './market-quickbar'
import { exportMarketQuickbarText, importMarketQuickbarText } from './market-quickbar-transfer'
import { buildMarketQuickbarTree, type MarketQuickbarNode } from './market-quickbar-tree'

type QuickbarRejection =
  | 'catalogue-unavailable'
  | 'clipboard-unavailable'
  | 'folder-conflict'
  | 'folder-limit'
  | 'invalid-folder'
  | 'invalid-import'
  | 'invalid-item'
  | 'invalid-target'
  | 'item-limit'

export type QuickbarOutcome =
  | { readonly status: 'applied'; readonly persisted?: boolean }
  | { readonly status: 'unchanged' }
  | { readonly status: 'rejected'; readonly reason: QuickbarRejection }

export interface MarketQuickbarAdapters {
  readonly storage: Pick<Storage, 'getItem' | 'setItem'>
  readonly clipboard: {
    readText(): Promise<string>
    writeText(text: string): Promise<void>
  }
  readonly createId: () => string
}

const browserAdapters = (): MarketQuickbarAdapters => ({
  storage: {
    getItem: (key) => globalThis.localStorage.getItem(key),
    setItem: (key, value) => globalThis.localStorage.setItem(key, value),
  },
  clipboard: useUiClipboard(),
  createId: () => crypto.randomUUID(),
})

const rejected = (reason: QuickbarRejection): QuickbarOutcome => ({ status: 'rejected', reason })

const importRejectionMessage = (reason: QuickbarRejection) => {
  if (reason === 'item-limit') return 'Quickbar import exceeds the 100-item limit.'
  if (reason === 'folder-limit') return 'Quickbar import exceeds the 50-folder limit.'
  if (reason === 'folder-conflict') return 'Quickbar import contains a conflicting folder.'
  if (reason === 'clipboard-unavailable') return 'Clipboard access is unavailable.'
  if (reason === 'catalogue-unavailable') return 'The current Market catalogue is unavailable.'
  return 'Quickbar import is invalid or contains unknown items.'
}

const importBounds = (
  current: MarketQuickbarState,
  incoming: MarketQuickbarState,
): QuickbarRejection | null => {
  const currentIds = new Set(marketQuickbarTypeIds(current))
  const incomingIds = marketQuickbarTypeIds(incoming)
  if (
    incomingIds.filter((id) => !currentIds.has(id)).length + currentIds.size >
    maxMarketQuickbarItems
  ) {
    return 'item-limit'
  }
  if (Object.keys(current).length + Object.keys(incoming).length - 2 > maxMarketQuickbarFolders) {
    return 'folder-limit'
  }
  if (Object.keys(incoming).some((id) => id !== rootQuickbarFolderId && current[id])) {
    return 'folder-conflict'
  }
  return null
}

const createQuickbarPresentation = (
  state: Ref<MarketQuickbarState>,
  types: Readonly<Ref<readonly MarketType[] | null>>,
  selectedId: Readonly<Ref<number | null>>,
) => {
  const pinnedTypeIds = computed(() => marketQuickbarTypeIds(state.value))
  const typesById = computed(() => new Map((types.value ?? []).map((item) => [item.id, item])))
  const nodes = computed(() => buildMarketQuickbarTree(state.value, typesById.value))
  const selectedNode = computed<MarketQuickbarNode | undefined>(() => {
    const id = selectedId.value
    if (id === null || !pinnedTypeIds.value.includes(id)) return undefined
    const item = typesById.value.get(id)
    return item ? { kind: 'item', id, item } : undefined
  })
  const folderOptions = computed(() => marketQuickbarFolderOptions(state.value))
  const empty = computed(
    () =>
      pinnedTypeIds.value.length === 0 &&
      state.value[rootQuickbarFolderId].childFolders.length === 0,
  )
  const unavailablePinnedIds = computed(() =>
    types.value ? pinnedTypeIds.value.filter((id) => !typesById.value.has(id)) : [],
  )
  const selectedIsPinned = computed(
    () => selectedId.value !== null && pinnedTypeIds.value.includes(selectedId.value),
  )
  const canPinSelected = computed(
    () => selectedIsPinned.value || pinnedTypeIds.value.length < maxMarketQuickbarItems,
  )
  return {
    pinnedTypeIds,
    nodes,
    selectedNode,
    folderOptions,
    empty,
    unavailablePinnedIds,
    selectedIsPinned,
    canPinSelected,
  }
}

type ApplyQuickbar = (next: MarketQuickbarState) => QuickbarOutcome

const createQuickbarPersistence =
  (
    state: Ref<MarketQuickbarState>,
    persistent: Ref<boolean>,
    message: Ref<string>,
    storage: MarketQuickbarAdapters['storage'],
  ): ApplyQuickbar =>
  (next) => {
    if (next === state.value || JSON.stringify(next) === JSON.stringify(state.value))
      return { status: 'unchanged' }
    state.value = next
    message.value = ''
    try {
      storage.setItem(marketQuickbarStorageKey, JSON.stringify(next))
      persistent.value = true
      return { status: 'applied', persisted: true }
    } catch {
      persistent.value = false
      return { status: 'applied', persisted: false }
    }
  }

const createQuickbarChanges = (
  state: Ref<MarketQuickbarState>,
  expanded: Ref<string[]>,
  selectedId: Readonly<Ref<number | null>>,
  presentation: ReturnType<typeof createQuickbarPresentation>,
  createId: () => string,
  apply: ApplyQuickbar,
) => {
  const { pinnedTypeIds, selectedIsPinned } = presentation
  const addItem = (id: number, folderId = rootQuickbarFolderId): QuickbarOutcome => {
    if (!Number.isSafeInteger(id) || id <= 0) return rejected('invalid-item')
    if (pinnedTypeIds.value.includes(id)) return { status: 'unchanged' }
    if (pinnedTypeIds.value.length >= maxMarketQuickbarItems) return rejected('item-limit')
    if (!state.value[folderId]) return rejected('invalid-target')
    return apply(addMarketQuickbarItem(state.value, id, folderId))
  }
  const removeItem = (id: number) => apply(removeMarketQuickbarItem(state.value, id))
  const toggleSelectedPin = (): QuickbarOutcome => {
    if (selectedId.value === null) return rejected('invalid-item')
    return selectedIsPinned.value ? removeItem(selectedId.value) : addItem(selectedId.value)
  }
  const createFolder = (parentId: string, name: string): QuickbarOutcome => {
    if (Object.keys(state.value).length > maxMarketQuickbarFolders) return rejected('folder-limit')
    if (!name.trim() || name.length > 80) return rejected('invalid-folder')
    if (!state.value[parentId]) return rejected('invalid-target')
    const next = createMarketQuickbarFolder(state.value, createId(), name, parentId)
    return next === state.value ? rejected('invalid-folder') : apply(next)
  }
  const createRootFolder = (name: string) => createFolder(rootQuickbarFolderId, name)
  const moveItem = (id: number, destinationId: string): QuickbarOutcome => {
    if (!state.value[destinationId]) return rejected('invalid-target')
    return apply(moveMarketQuickbarItem(state.value, id, destinationId))
  }
  const moveFolder = (id: string, destinationId: string): QuickbarOutcome => {
    if (!state.value[destinationId]) return rejected('invalid-target')
    return apply(moveMarketQuickbarFolder(state.value, id, destinationId))
  }
  const renameFolder = (id: string, name: string) =>
    apply(renameMarketQuickbarFolder(state.value, id, name))
  const removeFolder = (id: string) => apply(removeMarketQuickbarFolder(state.value, id))
  const dropOnFolder = (data: MarketQuickbarDragData, destinationId: string): QuickbarOutcome => {
    if (data.scope !== 'market-quickbar') return rejected('invalid-target')
    if (data.kind === 'folder') return moveFolder(data.id, destinationId)
    if (data.kind === 'item') {
      const id = Number(data.id)
      return Number.isSafeInteger(id) && id > 0
        ? moveItem(id, destinationId)
        : rejected('invalid-item')
    }
    return rejected('invalid-item')
  }
  const toggleFolder = (id: string) => {
    const key = `folder:${id}`
    expanded.value = expanded.value.includes(key)
      ? expanded.value.filter((entry) => entry !== key)
      : [...expanded.value, key]
  }
  const clear = (): QuickbarOutcome => {
    expanded.value = []
    return apply(emptyMarketQuickbar())
  }
  return {
    addItem,
    removeItem,
    toggleSelectedPin,
    createFolder,
    createRootFolder,
    moveItem,
    moveFolder,
    renameFolder,
    removeFolder,
    dropOnFolder,
    toggleFolder,
    clear,
  }
}

const createQuickbarTransfer = (
  state: Ref<MarketQuickbarState>,
  types: Readonly<Ref<readonly MarketType[] | null>>,
  message: Ref<string>,
  adapters: MarketQuickbarAdapters,
  apply: ApplyQuickbar,
) => {
  const importText = (text: string): QuickbarOutcome => {
    if (!types.value) return rejected('catalogue-unavailable')
    const incoming = importMarketQuickbarText(text, types.value, adapters.createId)
    if (!incoming) return rejected('invalid-import')
    const bound = importBounds(state.value, incoming)
    if (bound) return rejected(bound)
    const next = mergeMarketQuickbars(state.value, incoming)
    return next === state.value ? rejected('invalid-import') : apply(next)
  }
  const importQuickbar = async (): Promise<QuickbarOutcome> => {
    let outcome: QuickbarOutcome
    try {
      outcome = importText(await adapters.clipboard.readText())
    } catch {
      outcome = rejected('clipboard-unavailable')
    }
    if (outcome.status === 'rejected') message.value = importRejectionMessage(outcome.reason)
    else if (outcome.status === 'unchanged')
      message.value = 'Quickbar already contains these items.'
    else
      message.value = outcome.persisted
        ? 'Quickbar imported.'
        : 'Quickbar imported for this session; browser storage is unavailable.'
    return outcome
  }
  const exportQuickbar = async (): Promise<QuickbarOutcome> => {
    const text = exportMarketQuickbarText(state.value, types.value ?? [])
    if (text === null) {
      message.value = 'Some saved items no longer match the current catalogue.'
      return rejected('catalogue-unavailable')
    }
    try {
      await adapters.clipboard.writeText(text)
      message.value = 'Quickbar copied to clipboard.'
      return { status: 'applied' }
    } catch {
      message.value = 'Clipboard access is unavailable.'
      return rejected('clipboard-unavailable')
    }
  }
  return { importQuickbar, exportQuickbar }
}

export const useMarketQuickbar = (
  types: Readonly<Ref<readonly MarketType[] | null>>,
  selectedId: Readonly<Ref<number | null>>,
  adapters: MarketQuickbarAdapters = browserAdapters(),
) => {
  const state = ref<MarketQuickbarState>(emptyMarketQuickbar())
  const expanded = ref<string[]>([])
  const persistent = ref(true)
  const message = ref('')
  const presentation = createQuickbarPresentation(state, types, selectedId)
  const apply = createQuickbarPersistence(state, persistent, message, adapters.storage)
  const changes = createQuickbarChanges(
    state,
    expanded,
    selectedId,
    presentation,
    adapters.createId,
    apply,
  )
  const transfer = createQuickbarTransfer(state, types, message, adapters, apply)

  onMounted(() => {
    try {
      state.value = restoreMarketQuickbar(adapters.storage.getItem(marketQuickbarStorageKey))
    } catch {
      state.value = emptyMarketQuickbar()
      persistent.value = false
    }
  })

  return {
    state,
    expanded,
    persistent,
    message,
    ...presentation,
    ...changes,
    ...transfer,
  }
}

export type MarketQuickbar = ReturnType<typeof useMarketQuickbar>
